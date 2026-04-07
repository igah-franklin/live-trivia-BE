import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import type { Queue } from 'bullmq';

// ─── Domain Types ────────────────────────────────────────────────────────────

export type OptionKey = 'A' | 'B' | 'C' | 'D';

export interface Question {
  id: string;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: OptionKey;
  category: string | null;
  difficulty: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ActiveRoundState {
  id: string;
  gameSessionId?: string;
  accountId?: string;
  questionId: string;
  status: 'idle' | 'live' | 'closed' | 'resolved';
  startTime: number;
  endTime: number;
  durationSeconds: number;
  question: {
    prompt: string;
    options: { A: string; B: string; C: string; D: string };
    correctOption: OptionKey; // only for internal/operator use
  };
}

// Safe version without correctOption, for public socket events
export type SafeRoundState = Omit<ActiveRoundState, 'question'> & {
  question: Omit<ActiveRoundState['question'], 'correctOption'>;
};

export interface AnswerDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  total: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  parsedAnswer?: OptionKey | null;
  isValid: boolean;
  isDuplicate: boolean;
  receivedAt: number;
}

// ─── Score Job ───────────────────────────────────────────────────────────────

export interface ScoreJobData {
  roundId: string;
}

// ─── Fastify Decorations ─────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    io: SocketServer;
    scoreQueue: Queue<ScoreJobData>;
  }
}
