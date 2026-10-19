import { db } from '../db';
import { todayKey } from './time';

export async function tokensToday(): Promise<number> {
  return (await db.usage.get(todayKey()))?.tokens ?? 0;
}

export async function addTokens(n: number): Promise<void> {
  if (!n) return;
  const date = todayKey();
  await db.transaction('rw', db.usage, async () => {
    const row = await db.usage.get(date);
    await db.usage.put({ date, tokens: (row?.tokens ?? 0) + n });
  });
}

/** Rough count for budgeting before a call (about 3.5 characters per token). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);
