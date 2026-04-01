import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { RedisKeys } from '../../lib/redis.keys.js';

export class ScoresService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async adjustScore(userId: string, adjustment: number) {
    const score = await this.prisma.score.findUnique({ where: { userPlatformId: userId } });
    if (!score) throw new Error(`User ${userId} not found`);

    const newScore = Math.max(0, score.score + adjustment);
    const delta = newScore - score.score;

    const [updated] = await Promise.all([
      this.prisma.score.update({
        where: { userPlatformId: userId },
        data: { score: newScore, lastUpdatedAt: new Date() },
      }),
      // Update Redis sorted set atomically
      delta !== 0
        ? this.redis.zincrby(RedisKeys.LEADERBOARD, delta, `${userId}:${score.username}`)
        : Promise.resolve(),
    ]);

    return updated;
  }

  async getAll() {
    return this.prisma.score.findMany({
      orderBy: { score: 'desc' },
    });
  }
}
