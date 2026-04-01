import { z } from 'zod';

export const OptionKeySchema = z.enum(['A', 'B', 'C', 'D']);

export const CreateQuestionSchema = z.object({
  prompt: z.string().min(5, 'Prompt must be at least 5 characters'),
  optionA: z.string().min(1, 'Option A is required'),
  optionB: z.string().min(1, 'Option B is required'),
  optionC: z.string().min(1, 'Option C is required'),
  optionD: z.string().min(1, 'Option D is required'),
  correctOption: OptionKeySchema,
  category: z.string().optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
});

export const UpdateQuestionSchema = CreateQuestionSchema.partial();

export const GenerateQuestionSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
});

// Shape Claude must return
export const GeneratedQuestionResponseSchema = z.object({
  prompt: z.string().min(10),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correctOption: OptionKeySchema,
  category: z.string(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
});

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;
export type GenerateQuestionInput = z.infer<typeof GenerateQuestionSchema>;
export type GeneratedQuestionResponse = z.infer<typeof GeneratedQuestionResponseSchema>;
