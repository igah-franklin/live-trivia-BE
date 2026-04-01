import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import type { OptionKey, ActiveRoundState, AnswerDistribution } from '../../types/index.js';
import { RedisKeys } from '../../lib/redis.keys.js';
import { SocketEvents } from '../../socket/events.js';

interface ProcessAnswerInput {
  roundId: string;
  userPlatformId: string;
  username: string;
  selectedOption: OptionKey;
}

interface ProcessAnswerResult {
  recorded: boolean;
  isDuplicate: boolean;
  notLive: boolean;
}

// In-memory distribution buffer for debounced broadcast
interface DistributionBuffer {
  roundId: string;
  data: AnswerDistribution;
  timer: NodeJS.Timeout | null;
}

export class AnswersService {
  private distBuffer: DistributionBuffer | null = null;
  private readonly DEBOUNCE_MS = 500;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly io: SocketServer,
  ) {}

  /**
   * CRITICAL HOT PATH — must complete in < 5ms (Redis only, async Postgres)
   */
  async processAnswer(input: ProcessAnswerInput): Promise<ProcessAnswerResult> {
    const { roundId, userPlatformId, username, selectedOption } = input;

    // Step 1: Check if round is live (Redis GET — O(1))
    const rawState = await this.redis.get(RedisKeys.ROUND_ACTIVE);
    if (!rawState) {
      return { recorded: false, isDuplicate: false, notLive: true };
    }

    const state = JSON.parse(rawState) as ActiveRoundState;

    if (state.status !== 'live' || state.id !== roundId) {
      return { recorded: false, isDuplicate: false, notLive: true };
    }

    // Step 2: Atomic Lua script — dedup check + record (2 Redis ops in 1 round-trip)
    const answersKey = RedisKeys.roundAnswers(roundId);
    const distKey = RedisKeys.roundDist(roundId);

    const result = await (this.redis as Redis & {
      recordAnswer(answersKey: string, distKey: string, userId: string, option: string): Promise<number>;
    }).recordAnswer(answersKey, distKey, userPlatformId, selectedOption);

    if (result === 0) {
      // Duplicate — already answered
      return { recorded: false, isDuplicate: true, notLive: false };
    }

    // Step 3: Persist to Postgres ASYNCHRONOUSLY (fire and forget)
    setImmediate(() => {
      this.prisma.answer.create({
        data: {
          roundId,
          userPlatformId,
          username,
          selectedOption,
        },
      }).catch(() => {
        // Duplicate constraint violation is expected and acceptable
        // The Redis dedup is the authoritative check
      });
    });

    // Step 4: Get current answer count for operator event
    const totalAnswers = await this.redis.scard(answersKey);

    // Step 5: Emit answer:received to operator room only
    this.io.to('operator').emit(SocketEvents.ANSWER_RECEIVED, {
      username,
      selectedOption,
      totalAnswers,
    });

    // Step 6: Debounced distribution broadcast (max once per 500ms)
    this.scheduleDebouncedDistribution(roundId);

    return { recorded: true, isDuplicate: false, notLive: false };
  }

  /**
   * Debounce the distribution broadcast — buffer incoming and flush once per 500ms
   */
  private scheduleDebouncedDistribution(roundId: string) {
    if (this.distBuffer?.timer) {
      // Already scheduled, let the existing timer fire
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await this.flushDistribution(roundId);
      } catch {
        // Non-critical — distribution is best-effort
      }
      if (this.distBuffer) {
        this.distBuffer.timer = null;
      }
    }, this.DEBOUNCE_MS);

    this.distBuffer = { roundId, data: { A: 0, B: 0, C: 0, D: 0, total: 0 }, timer };
  }

  private async flushDistribution(roundId: string) {
    const distKey = RedisKeys.roundDist(roundId);
    const answersKey = RedisKeys.roundAnswers(roundId);

    const [dist, total] = await Promise.all([
      this.redis.hgetall(distKey),
      this.redis.scard(answersKey),
    ]);

    const distribution: AnswerDistribution = {
      A: parseInt(dist['A'] ?? '0', 10),
      B: parseInt(dist['B'] ?? '0', 10),
      C: parseInt(dist['C'] ?? '0', 10),
      D: parseInt(dist['D'] ?? '0', 10),
      total,
    };

    this.io.emit(SocketEvents.ANSWER_DISTRIBUTION, distribution);
  }

  // Exposed for use by rounds resolution
  async getDistribution(roundId: string): Promise<AnswerDistribution> {
    const distKey = RedisKeys.roundDist(roundId);
    const answersKey = RedisKeys.roundAnswers(roundId);

    const [dist, total] = await Promise.all([
      this.redis.hgetall(distKey),
      this.redis.scard(answersKey),
    ]);

    return {
      A: parseInt(dist['A'] ?? '0', 10),
      B: parseInt(dist['B'] ?? '0', 10),
      C: parseInt(dist['C'] ?? '0', 10),
      D: parseInt(dist['D'] ?? '0', 10),
      total,
    };
  }
}
