import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { RedisKeys } from '../../lib/redis.keys.js';
import type { LeaderboardEntry } from '../../types/index.js';

export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  /**
   * Get top N entries from Redis sorted set (O(log N)).
   * Falls back to Postgres if Redis is unavailable.
   */
  async getTopLeaderboard(limit = 10, accountId?: string): Promise<LeaderboardEntry[]> {
    const redisKey = accountId ? `${RedisKeys.LEADERBOARD}:${accountId}` : RedisKeys.LEADERBOARD;
    try {
      const raw = await this.redis.zrevrange(redisKey, 0, limit - 1, 'WITHSCORES');

      if (raw.length === 0) {
        return this.getFromPostgres(limit, accountId);
      }

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
    } catch {
      // Redis unavailable — fall back to Postgres
      return this.getFromPostgres(limit, accountId);
    }
  }

  private async getFromPostgres(limit: number, accountId?: string): Promise<LeaderboardEntry[]> {
    const scores = await this.prisma.score.findMany({
      where: accountId ? { accountId } as any : {},
      take: limit,
      orderBy: { score: 'desc' },
    });

    return scores.map((s, i) => ({
      rank: i + 1,
      userId: s.userPlatformId,
      username: s.username,
      score: s.score,
    }));
  }
}
