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
  const client = getClient();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: `You are a trivia question generator. Always respond with ONLY a valid JSON object and nothing else. No markdown, no preamble, no explanation. The JSON must have exactly these fields: prompt (string), optionA (string), optionB (string), optionC (string), optionD (string), correctOption ('A'|'B'|'C'|'D'), category (string), difficulty ('Easy'|'Medium'|'Hard').`,
    messages: [
      {
        role: 'user',
        content: `Generate a ${difficulty} trivia question about ${topic}. Return only the JSON object.`,
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

  const parsed = GeneratedQuestionResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`AI response failed validation: ${parsed.error.message}`);
  }

  return parsed.data as GeneratedQuestionResponse & CreateQuestionInput;
}
