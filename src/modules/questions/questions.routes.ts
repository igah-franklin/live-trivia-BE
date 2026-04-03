import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireOperator } from '../../middleware/auth.js';
import { QuestionsService } from './questions.service.js';
import {
  CreateQuestionSchema,
  UpdateQuestionSchema,
} from './questions.schema.js';
import { generateQuestion } from '../ai/ai.service.js';
import { z } from 'zod';

export async function questionsRoutes(fastify: FastifyInstance) {
  const svc = new QuestionsService(fastify.prisma, fastify.redis);

  // GET /api/questions — public (no correctOption), operator (with correctOption)
  fastify.get('/questions', async (req: FastifyRequest, reply: FastifyReply) => {
    const isOperator = req.headers.authorization?.startsWith('Bearer ');
    const questions = await svc.findAll(isOperator);
    return reply.send(questions);
  });

  // GET /api/questions/:id
  fastify.get<{ Params: { id: string } }>('/questions/:id', async (req, reply: FastifyReply) => {
    const isOperator = req.headers.authorization?.startsWith('Bearer ');
    const question = await svc.findById(req.params.id, isOperator);
    if (!question) return reply.status(404).send({ error: 'Question not found' });
    return reply.send(question);
  });

  // POST /api/questions — operator only
  fastify.post(
    '/questions',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateQuestionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const question = await svc.create(parsed.data);
      return reply.status(201).send(question);
    }
  );

  // POST /api/questions/ai-preview — operator only
  fastify.post(
    '/questions/ai-preview',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = z.object({
        topic: z.string().min(1),
        difficulty: z.enum(['Easy', 'Medium', 'Hard']),
        count: z.number().int().min(1).max(5).default(1),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        const { generateQuestions } = await import('../ai/ai.service.js');
        const generated = await generateQuestions(parsed.data.topic, parsed.data.difficulty, parsed.data.count);
        return reply.send(generated);
      } catch (err) {
        fastify.log.error({ err }, 'AI question preview generation failed');
        return reply.status(500).send({
          error: 'AI generation failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/questions/generate — operator only (must be before /:id)
  fastify.post(
    '/questions/generate',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = z.object({
        topic: z.string().min(1),
        difficulty: z.enum(['Easy', 'Medium', 'Hard']),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        const generated = await generateQuestion(parsed.data.topic, parsed.data.difficulty);
        const question = await svc.create(generated);
        return reply.status(201).send(question);
      } catch (err) {
        fastify.log.error({ err }, 'AI question generation failed');
        return reply.status(500).send({
          error: 'AI generation failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // PUT /api/questions/:id — operator only
  fastify.put<{ Params: { id: string } }>(
    '/questions/:id',
    { preHandler: requireOperator },
    async (req, reply: FastifyReply) => {
      const parsed = UpdateQuestionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      try {
        const question = await svc.update(req.params.id, parsed.data);
        return reply.send(question);
      } catch {
        return reply.status(404).send({ error: 'Question not found' });
      }
    }
  );

  // DELETE /api/questions/:id — operator only (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/questions/:id',
    { preHandler: requireOperator },
    async (req, reply: FastifyReply) => {
      try {
        await svc.softDelete(req.params.id);
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'Question not found' });
      }
    }
  );
}
