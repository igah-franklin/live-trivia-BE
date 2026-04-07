import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { RedisKeys } from '../../lib/redis.keys.js';

export class ScoresService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async adjustScore(userId: string, adjustment: number) {
    const score = await this.prisma.score.findFirst({ where: { userPlatformId: userId } });
    if (!score) throw new Error(`User ${userId} not found`);

    const newScore = Math.max(0, score.score + adjustment);
    const delta = newScore - score.score;
    
    const accountId = (score as any).accountId;
    const redisKey = accountId ? `${RedisKeys.LEADERBOARD}:${accountId}` : RedisKeys.LEADERBOARD;

    const [updated] = await Promise.all([
      this.prisma.score.update({
        where: { id: score.id },
        data: { score: newScore, lastUpdatedAt: new Date() },
      }),
      // Update Redis sorted set atomically
      delta !== 0
        ? this.redis.zincrby(redisKey, delta, `${userId}:${score.username}`)
        : Promise.resolve(),
    ]);

    return updated;
  }

  async getAll(accountId?: string) {
    const where: any = accountId ? { accountId } : {};
    return this.prisma.score.findMany({
      where,
      orderBy: { score: 'desc' },
    });
  }
}
