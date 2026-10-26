import type { StackAdapter } from '../types.ts';
import { kirby } from './kirby.ts';
import { nuxt } from './nuxt.ts';
import { wordpress } from './wordpress.ts';

export const adapters: StackAdapter[] = [nuxt, kirby, wordpress];

export async function detectAdapters(dir: string): Promise<StackAdapter[]> {
  const results = await Promise.all(adapters.map((a) => a.detect(dir)));
  return adapters.filter((_, i) => results[i]);
}
