import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LeaderboardService } from './leaderboard.service.js';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  const svc = new LeaderboardService(fastify.prisma, fastify.redis);

  // GET /api/leaderboard — public, Redis sorted set O(log N)
  fastify.get('/leaderboard', async (req: FastifyRequest, reply: FastifyReply) => {
    const accountId = req.headers['x-account-id'] as string | undefined;
    const entries = await svc.getTopLeaderboard(10, accountId);
    return reply.send({ entries });
  });
}
