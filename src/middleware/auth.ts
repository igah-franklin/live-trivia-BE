import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Operator Auth Hook — validates Bearer token in Authorization header.
 * Attach as preHandler on operator-only routes.
 */
export async function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = request.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing Authorization: Bearer <token> header',
    });
  }

  const token = auth.slice(7).trim();

  if (token !== env.OPERATOR_API_KEY) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Invalid operator API key',
    });
  }
}
