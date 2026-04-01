import type { OptionKey } from '../types/index.js';

/**
 * Parse a raw chat message and extract the selected trivia option.
 *
 * Rules (applied in order):
 *  1. Trim + uppercase
 *  2. "answer A" / "answer: B" / "answer - C" patterns
 *  3. "it's B" / "definitely A" / "going with C" / "i choose D" / "my answer is A"
 *  4. "A." / "B)" / "A," standalone letter with punctuation
 *  5. Bare standalone letter \bA\b
 *  6. If multiple DISTINCT letters found → return null (ambiguous)
 */
export function parseAnswer(text: string): OptionKey | null {
  const upper = text.trim().toUpperCase();

  const patterns: RegExp[] = [
    /\banswer\s*[:\-]?\s*([ABCD])\b/i,
    /(?:IT'?S|DEFINITELY|GOING WITH|I CHOOSE|MY ANSWER IS)\s*([ABCD])\b/i,
    /\b([ABCD])[.)]\s/,
    /\b([ABCD])[.)],?\s*$/,
    /\b([ABCD])\b/,
  ];

  const found = new Set<string>();

  for (const pattern of patterns) {
    const match = upper.match(pattern);
    if (match?.[1]) {
      found.add(match[1]);
    }
  }

  // Ambiguous — multiple distinct options detected
  if (found.size > 1) return null;
  if (found.size === 1) return found.values().next().value as OptionKey;

  return null;
}
