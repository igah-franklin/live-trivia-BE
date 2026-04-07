import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { CreateQuestionInput, UpdateQuestionInput } from './questions.schema.js';
import { RedisKeys } from '../../lib/redis.keys.js';

export class QuestionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async findAll(includeCorrectOption = false, accountId?: string) {
    const cacheKey = accountId ? `${RedisKeys.QUESTIONS_CACHE}:${accountId}` : RedisKeys.QUESTIONS_CACHE;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      const questions = JSON.parse(cached) as ReturnType<typeof this.formatQuestion>[];
      if (!includeCorrectOption) {
        return questions.map(q => {
          const { correctOption: _co, ...rest } = q;
          return rest;
        });
      }
      return questions;
    }

    const where: any = { deletedAt: null };
    if (accountId) where.accountId = accountId;

    const questions = await this.prisma.question.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const formatted = questions.map(q => this.formatQuestion(q));
    await this.redis.setex(cacheKey, 60, JSON.stringify(formatted));

    if (!includeCorrectOption) {
      return formatted.map(q => {
        const { correctOption: _co, ...rest } = q;
        return rest;
      });
    }

    return formatted;
  }

  async findById(id: string, includeCorrectOption = false) {
    const question = await this.prisma.question.findFirst({
      where: { id, deletedAt: null },
    });

    if (!question) return null;

    const formatted = this.formatQuestion(question);
    if (!includeCorrectOption) {
      const { correctOption: _co, ...rest } = formatted;
      return rest;
    }
    return formatted;
  }

  async create(data: CreateQuestionInput, accountId?: string) {
    const question = await this.prisma.question.create({ data: { ...data, accountId } as any });
    await this.invalidateCache(accountId);
    return this.formatQuestion(question);
  }

  async update(id: string, data: UpdateQuestionInput, accountId?: string) {
    const question = await this.prisma.question.update({
      where: { id },
      data,
    });
    await this.invalidateCache(accountId);
    return this.formatQuestion(question);
  }

  async softDelete(id: string, accountId?: string) {
    const question = await this.prisma.question.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.invalidateCache(accountId);
    return question;
  }

  private formatQuestion(q: {
    id: string;
    prompt: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctOption: string;
    category: string | null;
    difficulty: string | null;
    createdAt: Date;
  }) {
    return {
      id: q.id,
      prompt: q.prompt,
      options: {
        A: q.optionA,
        B: q.optionB,
        C: q.optionC,
        D: q.optionD,
      },
      correctOption: q.correctOption,
      category: q.category,
      difficulty: q.difficulty,
      createdAt: q.createdAt,
    };
  }

  private async invalidateCache(accountId?: string) {
    await this.redis.del(RedisKeys.QUESTIONS_CACHE);
    if (accountId) await this.redis.del(`${RedisKeys.QUESTIONS_CACHE}:${accountId}`);
  }
}
