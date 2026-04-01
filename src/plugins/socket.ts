import fp from 'fastify-plugin';
import { Server as SocketServer } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

async function socketPlugin(fastify: FastifyInstance) {
  const origins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());

  const io = new SocketServer(fastify.server, {
    cors: {
      origin: origins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    fastify.log.info({ socketId: socket.id }, 'Socket connected');

    socket.on('operator:join', () => {
      socket.join('operator');
      fastify.log.info({ socketId: socket.id }, 'Socket joined operator room');
    });

    socket.on('overlay:join', () => {
      socket.join('overlay');
      fastify.log.info({ socketId: socket.id }, 'Socket joined overlay room');
    });

    socket.on('disconnect', (reason) => {
      fastify.log.info({ socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  fastify.decorate('io', io);

  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    fastify.log.info('Socket.io server closed');
  });
}

export default fp(socketPlugin, {
  name: 'socket',
  fastify: '4.x',
});
