import { Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { RoundEngine } from '../modules/rounds/round.engine.js';
import { SCORE_QUEUE_NAME } from '../jobs/score.queue.js';
import type { ScoreJobData } from '../types/index.js';

// This worker runs in the same process (could be split for horizontal scaling)
// Using a separate Redis connection as required by BullMQ
const workerRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const prisma = new PrismaClient();

// Worker needs a minimal engine instance for resolveRound
// In production, the io instance is shared but here we need it available
// The worker is bootstrapped after the server so io is available via closure

let roundEngineRef: RoundEngine | null = null;

export function setRoundEngineRef(engine: RoundEngine): void {
  roundEngineRef = engine;
}

export function createScoreWorker(): Worker<ScoreJobData> {
  const worker = new Worker<ScoreJobData>(
    SCORE_QUEUE_NAME,
    async (job) => {
      if (!roundEngineRef) {
        throw new Error('RoundEngine not initialized in worker');
      }

      const { roundId } = job.data;
      console.log(`[Worker] Resolving round ${roundId} (attempt ${job.attemptsMade + 1})`);

      await roundEngineRef.resolveRound(roundId);

      console.log(`[Worker] Round ${roundId} resolved successfully`);
    },
    {
      connection: workerRedis,
      concurrency: 1, // Rounds resolve sequentially
      limiter: {
        max: 1,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
  });

  return worker;
}
