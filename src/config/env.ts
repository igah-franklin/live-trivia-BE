import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  OPERATOR_API_KEY: z.string().min(1, 'OPERATOR_API_KEY is required'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  ANTHROPIC_API_KEY: z.string().optional(),
  TIKTOK_SESSION_ID: z.string().optional(),
  // ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:8080'),
});
import * as dotenv from 'dotenv';

function loadEnv() {
  // Load .env file
  dotenv.config();

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach(issue => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
