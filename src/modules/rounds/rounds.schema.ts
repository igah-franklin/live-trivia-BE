import { z } from 'zod';

export const StartRoundSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  durationSeconds: z.union([z.literal(20), z.literal(30)]),
});

export const OverrideCorrectOptionSchema = z.object({
  correctOption: z.enum(['A', 'B', 'C', 'D']),
});

export type StartRoundInput = z.infer<typeof StartRoundSchema>;
export type OverrideCorrectOptionInput = z.infer<typeof OverrideCorrectOptionSchema>;
