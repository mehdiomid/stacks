import Dexie, { type EntityTable } from 'dexie';
import type { Item, Setting, Topic, UsageDay } from './types';

/** Everything lives in this IndexedDB database, in the browser. Nothing is sent to the Stacks server. */
export const db = new Dexie('stacks') as Dexie & {
  topics: EntityTable<Topic, 'id'>;
  items: EntityTable<Item, 'id'>;
  settings: EntityTable<Setting, 'key'>;
  usage: EntityTable<UsageDay, 'date'>;
};

db.version(1).stores({
  topics: 'id, order',
  items: 'id, topicId, normUrl, addedAt',
  settings: 'key',
  usage: 'date',
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** crypto.randomUUID needs a secure context; getRandomValues works everywhere. */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
