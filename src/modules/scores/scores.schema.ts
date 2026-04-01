import { z } from 'zod';

export const AdjustScoreSchema = z.object({
  adjustment: z.number().int().refine(n => n !== 0, { message: 'Adjustment cannot be zero' }),
});

export type AdjustScoreInput = z.infer<typeof AdjustScoreSchema>;
