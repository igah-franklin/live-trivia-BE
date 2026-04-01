import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireOperator } from '../../middleware/auth.js';
import { ScoresService } from './scores.service.js';
import { AdjustScoreSchema } from './scores.schema.js';

export async function scoresRoutes(fastify: FastifyInstance) {
  const svc = new ScoresService(fastify.prisma, fastify.redis);

  // PUT /api/scores/:userId — operator only
  fastify.put<{ Params: { userId: string } }>(
    '/scores/:userId',
    { preHandler: requireOperator },
    async (req, reply: FastifyReply) => {
      const parsed = AdjustScoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        const updated = await svc.adjustScore(req.params.userId, parsed.data.adjustment);
        return reply.send(updated);
      } catch (err) {
        return reply.status(404).send({
          error: 'User not found',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // GET /api/leaderboard/full — operator only (Postgres)
  fastify.get(
    '/leaderboard/full',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const scores = await svc.getAll();
      return reply.send(scores);
    }
  );
}
