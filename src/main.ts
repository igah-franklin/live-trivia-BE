import { buildServer } from './server.js';
import { env } from './config/env.js';

async function start() {
  const server = await buildServer();

  try {
    await server.listen({ port: env.PORT, host: env.HOST });
    server.log.info(`⚡ Trivia Live Engine running on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejections
  process.on('unhandledRejection', (reason) => {
    server.log.error({ reason }, 'Unhandled promise rejection');
  });
}

start();
