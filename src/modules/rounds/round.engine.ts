import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import type { Queue } from 'bullmq';
import type { ActiveRoundState, LeaderboardEntry, ScoreJobData } from '../../types/index.js';
import { RedisKeys } from '../../lib/redis.keys.js';
import { SocketEvents } from '../../socket/events.js';

interface AccountState {
  timeLeft: number;
  interval: NodeJS.Timeout | null;
  currentRoundId: string | null;
}

export class RoundEngine {
  private accountStates = new Map<string, AccountState>();

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
    private readonly io: SocketServer,
    private readonly scoreQueue: Queue<ScoreJobData>,
  ) {}

  private getAccountState(accountId: string = 'default'): AccountState {
    let state = this.accountStates.get(accountId);
    if (!state) {
      state = { timeLeft: 0, interval: null, currentRoundId: null };
      this.accountStates.set(accountId, state);
    }
    return state;
  }

  private emitToAccount(accountId: string = 'default', event: string, data: any) {
    const operatorRoom = `operator:${accountId}`;
    const overlayRoom = `overlay:${accountId}`;
    
    // Also emit to the legacy generic rooms if it's the default account
    if (accountId === 'default') {
      this.io.to('operator').to('overlay').to(operatorRoom).to(overlayRoom).emit(event, data);
    } else {
      this.io.to(operatorRoom).to(overlayRoom).emit(event, data);
    }
  }

  private getActiveRoundKey(accountId: string = 'default') {
    return accountId === 'default' ? RedisKeys.ROUND_ACTIVE : `${RedisKeys.ROUND_ACTIVE}:${accountId}`;
  }

  private getLeaderboardKey(accountId: string = 'default') {
    return accountId === 'default' ? RedisKeys.LEADERBOARD : `${RedisKeys.LEADERBOARD}:${accountId}`;
  }

  // ─── Start Round ─────────────────────────────────────────────────────────

  async startRound(questionId: string, durationSeconds: number, gameSessionId?: string, accountId: string = 'default') {
    const activeKey = this.getActiveRoundKey(accountId);
    
    // Guard: reject if a round is already live for this account
    const existing = await this.redis.get(activeKey);
    if (existing) {
      const parsed = JSON.parse(existing) as ActiveRoundState;
      if (parsed.status === 'live') {
        throw new Error('A round is already live for this account. End it before starting a new one.');
      }
    }

    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new Error(`Question not found: ${questionId}`);

    // Create the Round record in Postgres
    const round = await this.prisma.round.create({
      data: {
        questionId,
        gameSessionId,
        accountId: accountId === 'default' ? null : accountId,
        status: 'live',
        durationSeconds,
        startTime: new Date(),
      } as any,
    });

    const now = Date.now();
    const endTime = now + durationSeconds * 1000;

    const state: ActiveRoundState = {
      id: round.id,
      gameSessionId,
      accountId,
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
    await this.redis.set(activeKey, JSON.stringify(state));
    await this.redis.setex(RedisKeys.roundTimer(round.id), durationSeconds, '1');

    // Start internal timer
    const accState = this.getAccountState(accountId);
    accState.timeLeft = durationSeconds;
    accState.currentRoundId = round.id;
    this.startTimer(round.id, accountId);

    // Emit to this account's rooms
    this.emitToAccount(accountId, SocketEvents.ROUND_STARTED, {
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

  private startTimer(roundId: string, accountId: string = 'default') {
    const accState = this.getAccountState(accountId);
    if (accState.interval) clearInterval(accState.interval);

    accState.interval = setInterval(async () => {
      accState.timeLeft--;

      // Emit tick to this account's rooms
      this.emitToAccount(accountId, SocketEvents.ROUND_TICK, {
        roundId,
        timeLeft: accState.timeLeft,
      });

      if (accState.timeLeft <= 0) {
        await this.closeRound(accountId);
      }
    }, 1000);
  }

  // ─── Close Round ─────────────────────────────────────────────────────────

  async closeRound(accountId: string = 'default') {
    const accState = this.getAccountState(accountId);
    if (!accState.currentRoundId) return;

    if (accState.interval) {
      clearInterval(accState.interval);
      accState.interval = null;
    }

    const roundId = accState.currentRoundId;
    const activeKey = this.getActiveRoundKey(accountId);

    // Update Redis state to 'closed'
    const raw = await this.redis.get(activeKey);
    if (raw) {
      const state = JSON.parse(raw) as ActiveRoundState;
      state.status = 'closed';
      await this.redis.set(activeKey, JSON.stringify(state));
    }

    // Update Postgres
    await this.prisma.round.update({
      where: { id: roundId },
      data: { status: 'closed', endTime: new Date() },
    });

    this.emitToAccount(accountId, SocketEvents.ROUND_CLOSED, { roundId });

    // Enqueue score resolution job
    await this.scoreQueue.add('resolve-round', { roundId }, {
      jobId: `resolve-${roundId}`,
    });

    accState.currentRoundId = null;
  }

  // ─── Resolve Round ───────────────────────────────────────────────────────

  async resolveRound(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      include: { question: true, answers: true },
    });

    if (!round) throw new Error(`Round not found: ${roundId}`);

    const accountId = (round as any).accountId || 'default';
    const activeKey = this.getActiveRoundKey(accountId);
    const leaderboardKey = this.getLeaderboardKey(accountId);
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
      } as any,
    });

    // Update scores for correct answers
    const correctAnswers = round.answers.filter(a => a.selectedOption === correctOption);
    for (const answer of correctAnswers) {
      const member = `${answer.userPlatformId}:${answer.username}`;
      await this.redis.zincrby(leaderboardKey, 1, member);
    }

    // Upsert scores in Postgres
    for (const answer of round.answers) {
      const isCorrect = answer.selectedOption === correctOption;
      await this.prisma.score.upsert({
        where: { 
          accountId_userPlatformId: { 
            accountId: (round as any).accountId ?? '', 
            userPlatformId: answer.userPlatformId 
          } 
        } as any,
        create: {
          accountId: (round as any).accountId,
          userPlatformId: answer.userPlatformId,
          username: answer.username,
          score: isCorrect ? 1 : 0,
          roundsPlayed: 1,
          correctAnswers: isCorrect ? 1 : 0,
          lastUpdatedAt: new Date(),
        } as any,
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

    // Update Redis status if it matches
    const raw = await this.redis.get(activeKey);
    if (raw) {
      const state = JSON.parse(raw) as ActiveRoundState;
      if (state.id === roundId) {
        state.status = 'resolved';
        await this.redis.set(activeKey, JSON.stringify(state));
      }
    }

    const leaderboard = await this.getTopLeaderboard(10, accountId);

    // Compute session leaderboard
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

    this.emitToAccount(accountId, SocketEvents.ROUND_RESOLVED, {
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

    this.emitToAccount(accountId, SocketEvents.LEADERBOARD_UPDATED, { entries: leaderboard });

    await this.cleanupRoundKeys(roundId);
    return result;
  }

  // ─── Cancel Round ────────────────────────────────────────────────────────

  async cancelRound(accountId: string = 'default') {
    const accState = this.getAccountState(accountId);
    if (!accState.currentRoundId) {
      throw new Error('No active round to cancel for this account');
    }

    if (accState.interval) {
      clearInterval(accState.interval);
      accState.interval = null;
    }

    const roundId = accState.currentRoundId;
    accState.currentRoundId = null;

    await this.prisma.round.update({
      where: { id: roundId },
      data: { status: 'closed', endTime: new Date() },
    });

    await this.cleanupActiveRound(accountId);
    await this.cleanupRoundKeys(roundId);

    this.emitToAccount(accountId, SocketEvents.ROUND_CANCELLED, { roundId });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  getTimeLeft(accountId: string = 'default'): number {
    return this.getAccountState(accountId).timeLeft;
  }

  getCurrentRoundId(accountId: string = 'default'): string | null {
    return this.getAccountState(accountId).currentRoundId;
  }

  async getActiveRoundState(accountId: string = 'default'): Promise<ActiveRoundState | null> {
    const raw = await this.redis.get(this.getActiveRoundKey(accountId));
    return raw ? (JSON.parse(raw) as ActiveRoundState) : null;
  }

  async getTopLeaderboard(limit = 10, accountId: string = 'default'): Promise<LeaderboardEntry[]> {
    const raw = await this.redis.zrevrange(this.getLeaderboardKey(accountId), 0, limit - 1, 'WITHSCORES');
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

  private async cleanupActiveRound(accountId: string = 'default') {
    await this.redis.del(this.getActiveRoundKey(accountId));
  }
}
