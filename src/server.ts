import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';

import { env } from './config/env.js';

// Plugins
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import socketPlugin from './plugins/socket.js';

// Modules
import { questionsRoutes } from './modules/questions/questions.routes.js';
import { roundsRoutes } from './modules/rounds/rounds.routes.js';
import { scoresRoutes } from './modules/scores/scores.routes.js';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';

// Services
import { RoundEngine } from './modules/rounds/round.engine.js';
import { ChatService, ChatSimulator } from './modules/chat/chat.service.js';
import { TikTokAdapter } from './modules/chat/tiktok.adapter.js';

// Queue
import { scoreQueue } from './jobs/score.queue.js';

// Worker
import { createScoreWorker, setRoundEngineRef } from './workers/score.worker.js';

// Redis key helpers
import { RedisKeys } from './lib/redis.keys.js';
import { SocketEvents } from './socket/events.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    trustProxy: true,
  });

  // ─── Plugins ─────────────────────────────────────────────────────────────

  await fastify.register(fastifyCors, {
    origin: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(socketPlugin);

  // ─── Decorate with scoreQueue ─────────────────────────────────────────────

  fastify.decorate('scoreQueue', scoreQueue);

  // ─── Service instances ────────────────────────────────────────────────────

  const roundEngine = new RoundEngine(
    fastify.redis,
    fastify.prisma,
    fastify.io,
    scoreQueue,
  );

  const chatService = new ChatService(fastify.prisma, fastify.redis, fastify.io);
  const chatSimulator = new ChatSimulator(chatService);
  const tiktokAdapter = new TikTokAdapter(chatService, fastify.io);

  // Wire the round engine reference into the worker
  setRoundEngineRef(roundEngine);
  const scoreWorker = createScoreWorker();

  // ─── Health endpoint ──────────────────────────────────────────────────────

  fastify.get('/health', async (_req, reply) => {
    let redisOk = false;
    let dbOk = false;

    try {
      await fastify.redis.ping();
      redisOk = true;
    } catch { /* ignored */ }

    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch { /* ignored */ }

    const status = redisOk && dbOk ? 'ok' : 'degraded';
    return reply.status(redisOk && dbOk ? 200 : 503).send({
      status,
      uptime: process.uptime(),
      redis: redisOk,
      db: dbOk,
    });
  });

  // ─── Routes  ─────────────────────────────────────────────────────────────

  await fastify.register(async (app) => {
    await app.register(questionsRoutes);
    await app.register(async (a) => roundsRoutes(a, { roundEngine }));
    await app.register(scoresRoutes);
    await app.register(leaderboardRoutes);
    await app.register(async (a) => chatRoutes(a, { chatService, chatSimulator, tiktokAdapter }));
  }, { prefix: '/api' });

  // ─── Viewer count emitter ─────────────────────────────────────────────────

  const viewerInterval = setInterval(async () => {
    try {
      const raw = await fastify.redis.get(RedisKeys.VIEWER_COUNT);
      const count = raw ? parseInt(raw, 10) : fastify.io.engine.clientsCount;
      fastify.io.emit(SocketEvents.VIEWER_COUNT, { count });
    } catch { /* non-critical */ }
  }, 5000);

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  fastify.addHook('onClose', async () => {
    clearInterval(viewerInterval);
    chatSimulator.stop();
    await tiktokAdapter.disconnect().catch(() => { /* ignored */ });
    await scoreWorker.close();
    await scoreQueue.close();
  });

  fastify.log.info('Fastify server built successfully');

  return fastify;
}
