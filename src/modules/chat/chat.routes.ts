import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireOperator } from '../../middleware/auth.js';
import { z } from 'zod';
import type { ChatService, ChatSimulator } from './chat.service.js';
import type { TikTokAdapter } from './tiktok.adapter.js';

export async function chatRoutes(
  fastify: FastifyInstance,
  opts: {
    chatService: ChatService;
    chatSimulator: ChatSimulator;
    tiktokAdapter: TikTokAdapter;
  }
) {
  const { chatService, chatSimulator, tiktokAdapter } = opts;

  // POST /api/chat/simulate/start — operator only
  fastify.post(
    '/chat/simulate/start',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = z.object({ intervalMs: z.number().int().min(100).optional() });
      const parsed = bodySchema.safeParse(req.body);
      const intervalMs = parsed.success ? parsed.data.intervalMs ?? 800 : 800;

      chatSimulator.start(intervalMs);
      return reply.send({ ok: true, message: 'Chat simulator started', intervalMs });
    }
  );

  // POST /api/chat/simulate/stop — operator only
  fastify.post(
    '/chat/simulate/stop',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      chatSimulator.stop();
      return reply.send({ ok: true, message: 'Chat simulator stopped' });
    }
  );

  // POST /api/chat/tiktok/connect — operator only
  fastify.post(
    '/chat/tiktok/connect',
    { preHandler: requireOperator },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = z.object({ username: z.string().min(1) });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      try {
        await tiktokAdapter.connect(parsed.data.username);
        return reply.send({ ok: true, message: `Connected to @${parsed.data.username}` });
      } catch (err) {
        return reply.status(500).send({
          error: 'TikTok connect failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/chat/tiktok/disconnect — operator only
  fastify.post(
    '/chat/tiktok/disconnect',
    { preHandler: requireOperator },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      await tiktokAdapter.disconnect();
      return reply.send({ ok: true, message: 'TikTok disconnected' });
    }
  );

  // GET /api/chat/recent — public
  fastify.get('/chat/recent', async (_req: FastifyRequest, reply: FastifyReply) => {
    const messages = await chatService.getRecentMessages();
    return reply.send(messages);
  });
}
