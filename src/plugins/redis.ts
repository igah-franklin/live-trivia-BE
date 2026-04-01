import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

// Extend ioredis with our custom Lua command
declare module 'ioredis' {
  interface Redis {
    recordAnswer(
      answersKey: string,
      distKey: string,
      userId: string,
      option: string
    ): Promise<number>;
  }
}

async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('connect', () => fastify.log.info('Redis connected'));
  redis.on('error', (err: any) => fastify.log.error({ err }, 'Redis error'));
  redis.on('close', () => fastify.log.warn('Redis connection closed'));

  // Load and define the atomic Lua script
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const luaScript = readFileSync(
    join(__dirname, '../lib/answer.lua'),
    'utf-8'
  );

  redis.defineCommand('recordAnswer', {
    numberOfKeys: 2,
    lua: luaScript,
  });

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
    fastify.log.info('Redis disconnected');
  });
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});
