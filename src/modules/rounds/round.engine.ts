import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import type { Queue } from 'bullmq';
import type { ActiveRoundState, LeaderboardEntry, ScoreJobData } from '../../types/index.js';
import { RedisKeys } from '../../lib/redis.keys.js';
import { SocketEvents } from '../../socket/events.js';

export class RoundEngine {
  private timeLeft = 0;
  private interval: NodeJS.Timeout | null = null;
  private currentRoundId: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
    private readonly io: SocketServer,
    private readonly scoreQueue: Queue<ScoreJobData>,
  ) {}

  // ─── Start Round ─────────────────────────────────────────────────────────

  async startRound(questionId: string, durationSeconds: number, gameSessionId?: string) {
    // Guard: reject if a round is already live
    const existing = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    if (existing) {
      const parsed = JSON.parse(existing) as ActiveRoundState;
      if (parsed.status === 'live') {
        throw new Error('A round is already live. End it before starting a new one.');
      }
    }

    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new Error(`Question not found: ${questionId}`);

    // Create the Round record in Postgres
    const round = await this.prisma.round.create({
      data: {
        questionId,
        gameSessionId,
        status: 'live',
        durationSeconds,
        startTime: new Date(),
      },
    });

    const now = Date.now();
    const endTime = now + durationSeconds * 1000;

    const state: ActiveRoundState = {
      id: round.id,
      gameSessionId,
      questionId,
      status: 'live',
      startTime: now,
      endTime,
      durationSeconds,
      question: {
        prompt: question.prompt,
        options: {
          A: question.optionA,
          B: question.optionB,
          C: question.optionC,
          D: question.optionD,
        },
        correctOption: question.correctOption as 'A' | 'B' | 'C' | 'D',
      },
    };

    // Write to Redis
    await this.redis.set(RedisKeys.ROUND_ACTIVE, JSON.stringify(state));
    await this.redis.setex(RedisKeys.roundTimer(round.id), durationSeconds, '1');

    // Start internal timer
    this.timeLeft = durationSeconds;
    this.currentRoundId = round.id;
    this.startTimer(round.id);

    // Emit safe (no correctOption) to all clients
    this.io.emit(SocketEvents.ROUND_STARTED, {
      roundId: round.id,
      gameSessionId,
      questionId,
      prompt: question.prompt,
      options: state.question.options,
      durationSeconds,
      startTime: now,
      endTime,
    });

    return round;
  }

  // ─── Timer ───────────────────────────────────────────────────────────────

  private startTimer(roundId: string) {
    if (this.interval) clearInterval(this.interval);

    this.interval = setInterval(async () => {
      this.timeLeft--;

      // Emit tick to all clients
      this.io.emit(SocketEvents.ROUND_TICK, {
        roundId,
        timeLeft: this.timeLeft,
      });

      if (this.timeLeft <= 0) {
        await this.closeRound();
      }
    }, 1000);
  }

  // ─── Close Round ─────────────────────────────────────────────────────────

  async closeRound() {
    if (!this.currentRoundId) return;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const roundId = this.currentRoundId;

    // Update Redis state to 'closed'
    const raw = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    if (raw) {
      const state = JSON.parse(raw) as ActiveRoundState;
      state.status = 'closed';
      await this.redis.set(RedisKeys.ROUND_ACTIVE, JSON.stringify(state));
    }

    // Update Postgres
    await this.prisma.round.update({
      where: { id: roundId },
      data: { status: 'closed', endTime: new Date() },
    });

    this.io.emit(SocketEvents.ROUND_CLOSED, { roundId });

    // Enqueue score resolution job
    await this.scoreQueue.add('resolve-round', { roundId }, {
      jobId: `resolve-${roundId}`, // Deduplication key
    });

    this.currentRoundId = null;
  }

  // ─── Resolve Round ───────────────────────────────────────────────────────

  async resolveRound(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      include: { question: true, answers: true },
    });

    if (!round) throw new Error(`Round not found: ${roundId}`);

    const correctOption = round.question.correctOption as 'A' | 'B' | 'C' | 'D';

    // Compute distribution
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    for (const answer of round.answers) {
      dist[answer.selectedOption as keyof typeof dist]++;
    }

    const totalAnswers = round.answers.length;
    const correctCount = dist[correctOption];
    const correctPercentage = totalAnswers > 0
      ? Math.round((correctCount / totalAnswers) * 100)
      : 0;

    // Create RoundResult
    const result = await this.prisma.roundResult.create({
      data: {
        roundId,
        correctOption,
        totalAnswers,
        countA: dist.A,
        countB: dist.B,
        countC: dist.C,
        countD: dist.D,
        correctCount,
        correctPercentage,
      },
    });

    // Update scores for correct answers
    const correctAnswers = round.answers.filter(a => a.selectedOption === correctOption);

    for (const answer of correctAnswers) {
      // Update Redis leaderboard
      const member = `${answer.userPlatformId}:${answer.username}`;
      await this.redis.zincrby(RedisKeys.LEADERBOARD, 1, member);
    }

    // Upsert scores in Postgres for all participants
    for (const answer of round.answers) {
      const isCorrect = answer.selectedOption === correctOption;
      await this.prisma.score.upsert({
        where: { userPlatformId: answer.userPlatformId },
        create: {
          userPlatformId: answer.userPlatformId,
          username: answer.username,
          score: isCorrect ? 1 : 0,
          roundsPlayed: 1,
          correctAnswers: isCorrect ? 1 : 0,
          lastUpdatedAt: new Date(),
        },
        update: {
          username: answer.username,
          score: { increment: isCorrect ? 1 : 0 },
          roundsPlayed: { increment: 1 },
          correctAnswers: { increment: isCorrect ? 1 : 0 },
          lastUpdatedAt: new Date(),
        },
      });
    }

    // Update Postgres round to 'resolved'
    await this.prisma.round.update({
      where: { id: roundId },
      data: { status: 'resolved' },
    });

    // Update Redis ROUND:ACTIVE status to 'resolved'
    const raw = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    if (raw) {
      const state = JSON.parse(raw) as ActiveRoundState;
      if (state.id === roundId) {
        state.status = 'resolved';
        await this.redis.set(RedisKeys.ROUND_ACTIVE, JSON.stringify(state));
      }
    }

    // Get top 10 leaderboard
    const leaderboard = await this.getTopLeaderboard();

    // Compute session leaderboard if part of a game session
    let sessionLeaderboard = undefined;
    if (round.gameSessionId) {
      const roundsWithAnswers = await this.prisma.round.findMany({
        where: { gameSessionId: round.gameSessionId },
        include: { answers: true, question: true }
      });
      const userScores: Record<string, { username: string; score: number }> = {};
      for (const r of roundsWithAnswers) {
         const correctOpt = r.question.correctOption;
         for (const a of r.answers) {
            if (a.selectedOption === correctOpt) {
               if (!userScores[a.userPlatformId]) {
                  userScores[a.userPlatformId] = { username: a.username, score: 0 };
               }
               userScores[a.userPlatformId].score += 1;
            }
         }
      }
      sessionLeaderboard = Object.entries(userScores)
        .map(([userId, data]) => ({ userId, username: data.username, score: data.score }))
        .sort((a, b) => b.score - a.score);
    }

    // Emit resolved event to all clients (now reveal correctOption)
    this.io.emit(SocketEvents.ROUND_RESOLVED, {
      roundId,
      gameSessionId: round.gameSessionId,
      correctOption,
      distribution: dist,
      correctCount,
      correctPercentage,
      totalAnswers,
      leaderboard,
      sessionLeaderboard,
    });

    // Emit leaderboard update
    this.io.emit(SocketEvents.LEADERBOARD_UPDATED, { entries: leaderboard });

    // Clean up Redis round-specific keys
    await this.cleanupRoundKeys(roundId);

    return result;
  }

  // ─── Cancel Round ────────────────────────────────────────────────────────

  async cancelRound() {
    if (!this.currentRoundId) {
      throw new Error('No active round to cancel');
    }

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const roundId = this.currentRoundId;
    this.currentRoundId = null;

    await this.prisma.round.update({
      where: { id: roundId },
      data: { status: 'closed', endTime: new Date() },
    });

    await this.cleanupActiveRound();
    await this.cleanupRoundKeys(roundId);

    this.io.emit(SocketEvents.ROUND_CANCELLED, { roundId });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  getTimeLeft(): number {
    return this.timeLeft;
  }

  getCurrentRoundId(): string | null {
    return this.currentRoundId;
  }

  async getActiveRoundState(): Promise<ActiveRoundState | null> {
    const raw = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    return raw ? (JSON.parse(raw) as ActiveRoundState) : null;
  }

  async getTopLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const raw = await this.redis.zrevrange(RedisKeys.LEADERBOARD, 0, limit - 1, 'WITHSCORES');
    const entries: LeaderboardEntry[] = [];

    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const score = parseInt(raw[i + 1] ?? '0', 10);
      const colonIdx = member.indexOf(':');
      const userId = member.slice(0, colonIdx);
      const username = member.slice(colonIdx + 1);
      entries.push({ rank: entries.length + 1, userId, username, score });
    }

    return entries;
  }

  private async cleanupRoundKeys(roundId: string) {
    await this.redis.del(
      RedisKeys.roundAnswers(roundId),
      RedisKeys.roundDist(roundId),
      RedisKeys.roundTimer(roundId),
    );
  }

  private async cleanupActiveRound() {
    const raw = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    if (raw) {
      await this.redis.del(RedisKeys.ROUND_ACTIVE);
    }
  }
}
