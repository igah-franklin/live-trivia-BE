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
    async (req: FastifyRequest, reply: FastifyReply) => {
      const accountId = req.headers['x-account-id'] as string | undefined;
      const rounds = await fastify.prisma.round.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
                ...(accountId ? { where: { accountId } as any } : {}),
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
  fastify.get('/rounds/active', async (req: FastifyRequest, reply: FastifyReply) => {
    const accountId = req.headers['x-account-id'] as string | undefined;
    const state = await roundEngine.getActiveRoundState(accountId);

    if (!state) {
      return reply.send(null);
    }

    // Strip correctOption before returning
    const { question, ...rest } = state;
    const { correctOption: _co, ...safeQuestion } = question;

    return reply.send({ ...rest, question: safeQuestion });
  });

  // POST /api/sessions — operator only
  fastify.post(
    '/sessions',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { name } = req.body as { name: string };
      if (!name) return reply.status(400).send({ error: 'Session name is required' });

      const accountId = req.headers['x-account-id'] as string | undefined;

      try {
        const session = await fastify.prisma.gameSession.create({
          data: { name, accountId } as any,
        });
        return reply.status(201).send(session);
      } catch (err) {
        return reply.status(500).send({ error: 'Could not create session' });
      }
    }
  );

  // GET /api/sessions — operator only
  fastify.get(
    '/sessions',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const accountId = req.headers['x-account-id'] as string | undefined;
      const sessions = await fastify.prisma.gameSession.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
                ...(accountId ? { where: { accountId } as any } : {}),
        include: {
          rounds: {
            include: {
              question: {
                select: { id: true, prompt: true, category: true, difficulty: true },
              },
              result: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      return reply.send(sessions);
    }
  );

  // GET /api/sessions/:id — operator only
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: requireOperator },
    async (req, reply) => {
      const session = await fastify.prisma.gameSession.findUnique({
        where: { id: req.params.id },
        include: {
          rounds: {
            include: {
              question: {
                select: { id: true, prompt: true, category: true, difficulty: true },
              },
              result: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session) return reply.status(404).send({ error: 'Session not found' });

      // Calculate leaderboard specifically for this session
      const roundsWithAnswers = await fastify.prisma.round.findMany({
        where: { gameSessionId: req.params.id },
        include: {
          answers: true,
          question: true
        }
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
      
      const leaderboard = Object.entries(userScores)
        .map(([userId, data]) => ({ userId, username: data.username, score: data.score }))
        .sort((a, b) => b.score - a.score);

      return reply.send({ ...session, leaderboard });
    }
  );

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
        const accountId = req.headers['x-account-id'] as string | undefined;
        const round = await roundEngine.startRound(
          parsed.data.questionId,
          parsed.data.durationSeconds,
          parsed.data.gameSessionId,
          accountId
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
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const accountId = req.headers['x-account-id'] as string | undefined;
        await roundEngine.closeRound(accountId);
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
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const accountId = req.headers['x-account-id'] as string | undefined;
        await roundEngine.cancelRound(accountId);
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
