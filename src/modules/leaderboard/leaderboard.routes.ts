import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LeaderboardService } from './leaderboard.service.js';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  const svc = new LeaderboardService(fastify.prisma, fastify.redis);

  // GET /api/leaderboard — public, Redis sorted set O(log N)
  fastify.get('/leaderboard', async (_req: FastifyRequest, reply: FastifyReply) => {
    const entries = await svc.getTopLeaderboard(10);
    return reply.send({ entries });
  });
}
