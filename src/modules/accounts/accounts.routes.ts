import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireOperator } from '../../middleware/auth.js';
import { z } from 'zod';

export async function accountsRoutes(fastify: FastifyInstance) {
  // GET /api/accounts — list all accounts
  fastify.get('/accounts', { preHandler: requireOperator }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const accounts = await fastify.prisma.account.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(accounts);
  });

  // POST /api/accounts — create new account
  fastify.post('/accounts', { preHandler: requireOperator }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ name: z.string().min(1).max(50) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Name is required' });

    try {
      const account = await fastify.prisma.account.create({
        data: { name: parsed.data.name },
      });
      return reply.status(201).send(account);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return reply.status(409).send({ error: 'Account name already exists' });
      }
      throw e;
    }
  });

  // DELETE /api/accounts/:id
  fastify.delete<{ Params: { id: string } }>('/accounts/:id', { preHandler: requireOperator }, async (req, reply: FastifyReply) => {
    const { id } = req.params;
    if (id === 'default') return reply.status(400).send({ error: 'Cannot delete default account' });
    try {
      await fastify.prisma.account.delete({ where: { id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Account not found' });
    }
  });
}
