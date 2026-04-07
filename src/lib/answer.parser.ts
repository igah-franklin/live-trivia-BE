import type { OptionKey } from '../types/index.js';

export function parseAnswer(text: string): OptionKey | null {
  const upper = text.trim().toUpperCase();

  // Remove whitespace and common punctuation to allow "A." or " A " or "[B]"
  const clean = upper.replace(/[^A-Z]/g, '');

  // Strictly ensure the comment ONLY contains exactly one of the valid letters
  if (['A', 'B', 'C', 'D'].includes(clean) && clean.length === 1) {
    return clean as OptionKey;
  }

  return null;
}
