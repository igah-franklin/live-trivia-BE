import { z } from 'zod';

export const SubmitAnswerSchema = z.object({
  roundId: z.string().min(1),
  userPlatformId: z.string().min(1),
  username: z.string().min(1),
  selectedOption: z.enum(['A', 'B', 'C', 'D']),
});

export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
