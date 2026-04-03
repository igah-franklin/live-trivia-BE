import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { GeneratedQuestionResponseSchema } from '../questions/questions.schema.js';
import type { GeneratedQuestionResponse } from '../questions/questions.schema.js';
import type { CreateQuestionInput } from '../questions/questions.schema.js';

const getClient = (): Anthropic => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
};

export async function generateQuestion(
  topic: string,
  difficulty: 'Easy' | 'Medium' | 'Hard'
): Promise<CreateQuestionInput> {
  const questions = await generateQuestions(topic, difficulty, 1);
  return questions[0];
}

export async function generateQuestions(
  topic: string,
  difficulty: 'Easy' | 'Medium' | 'Hard',
  count: number = 1
): Promise<CreateQuestionInput[]> {
  const client = getClient();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: `You are a trivia question generator. Always respond with ONLY a valid JSON array of objects and nothing else. No markdown, no preamble, no explanation. Each object in the array must have exactly these fields: prompt (string), optionA (string), optionB (string), optionC (string), optionD (string), correctOption ('A'|'B'|'C'|'D'), category (string), difficulty ('Easy'|'Medium'|'Hard').`,
    messages: [
      {
        role: 'user',
        content: `Generate ${count} ${difficulty} level trivia questions about ${topic}. Return only the JSON array.`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(clean);
  } catch {
    throw new Error(`AI returned invalid JSON: ${clean.slice(0, 200)}`);
  }

  if (!Array.isArray(parsedJson)) {
    // If it returned a single object instead of array, wrap it
    parsedJson = [parsedJson];
  }

  const results: CreateQuestionInput[] = [];
  for (const item of (parsedJson as any[])) {
    const parsed = GeneratedQuestionResponseSchema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data as GeneratedQuestionResponse & CreateQuestionInput);
    }
  }

  if (results.length === 0) {
    throw new Error('AI failed to generate any valid questions');
  }

  return results;
}
