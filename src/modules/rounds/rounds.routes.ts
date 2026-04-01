import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireOperator } from '../../middleware/auth.js';
import { StartRoundSchema, OverrideCorrectOptionSchema } from './rounds.schema.js';
import type { RoundEngine } from './round.engine.js';

export async function roundsRoutes(
  fastify: FastifyInstance,
  opts: { roundEngine: RoundEngine }
) {
  const { roundEngine } = opts;

  // GET /api/rounds — operator only, last 20 rounds
  fastify.get(
    '/rounds',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const rounds = await fastify.prisma.round.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          question: {
            select: {
              id: true,
              prompt: true,
              category: true,
              difficulty: true,
            },
          },
          result: true,
        },
      });
      return reply.send(rounds);
    }
  );

  // GET /api/rounds/active — public, correctOption excluded
  fastify.get('/rounds/active', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = await roundEngine.getActiveRoundState();

    if (!state) {
      return reply.send(null);
    }

    // Strip correctOption before returning
    const { question, ...rest } = state;
    const { correctOption: _co, ...safeQuestion } = question;

    return reply.send({ ...rest, question: safeQuestion });
  });

  // POST /api/rounds/start — operator only
  fastify.post(
    '/rounds/start',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = StartRoundSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        const round = await roundEngine.startRound(
          parsed.data.questionId,
          parsed.data.durationSeconds
        );
        return reply.status(201).send(round);
      } catch (err) {
        return reply.status(409).send({
          error: 'Cannot start round',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/rounds/end — operator only
  fastify.post(
    '/rounds/end',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        await roundEngine.closeRound();
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(409).send({
          error: 'Cannot end round',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/rounds/cancel — operator only
  fastify.post(
    '/rounds/cancel',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        await roundEngine.cancelRound();
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(409).send({
          error: 'Cannot cancel round',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // PUT /api/rounds/:id/correct-option — operator only
  fastify.put<{ Params: { id: string } }>(
    '/rounds/:id/correct-option',
    { preHandler: requireOperator },
    async (req, reply: FastifyReply) => {
      const parsed = OverrideCorrectOptionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        const round = await fastify.prisma.round.update({
          where: { id: req.params.id },
          data: {
            question: {
              update: { correctOption: parsed.data.correctOption },
            },
          },
        });
        return reply.send(round);
      } catch {
        return reply.status(404).send({ error: 'Round not found' });
      }
    }
  );
}
