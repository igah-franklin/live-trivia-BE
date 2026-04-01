import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { env } from '../config/env.js';
import type { ScoreJobData } from '../types/index.js';

export const SCORE_QUEUE_NAME = 'score-resolution';

// Shared Redis connection for BullMQ
export const bullRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

export const scoreQueue = new Queue<ScoreJobData>(SCORE_QUEUE_NAME, {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
