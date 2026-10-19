import { db, newId } from './db';
import { scheduleBackup } from './lib/backup';
import { DAY } from './lib/time';
import { normalizeUrl } from './lib/url';
import type { Item, ItemKind, Topic, TopicSort } from './types';

/** All writes go through here so the folder backup runs after each change. */

const HUES = [232, 18, 188, 140, 36, 330, 268, 200, 0, 96, 300, 160];

async function changed<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  scheduleBackup();
  return r;
}

export async function createTopic(name: string, open = true): Promise<string> {
  const all = await db.topics.toArray();
  const existing = all.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing.id;
  const now = Date.now();
  const topic: Topic = {
    id: newId(),
    name: name.trim(),
    order: all.reduce((m, t) => Math.max(m, t.order), -1) + 1,
    hue: HUES[all.length % HUES.length],
    createdAt: now,
    lastActivityAt: now,
    open,
    sort: 'oldest',
  };
  await changed(db.topics.add(topic));
  return topic.id;
}

export const renameTopic = (id: string, name: string) => changed(db.topics.update(id, { name: name.trim() }));
export const setTopicOpen = (id: string, open: boolean) => db.topics.update(id, { open });
export const setTopicSort = (id: string, sort: TopicSort) => db.topics.update(id, { sort });

export async function deleteTopic(id: string): Promise<void> {
  await changed(
    db.transaction('rw', db.topics, db.items, async () => {
      await db.items.where('topicId').equals(id).delete();
      await db.topics.delete(id);
    }),
  );
}

/** Saves a new order. `ids` is the full list of topic ids, most important first. */
export async function reorderTopics(ids: string[]): Promise<void> {
  await changed(db.transaction('rw', db.topics, async () => {
    await Promise.all(ids.map((id, order) => db.topics.update(id, { order })));
  }));
}

export async function moveTopicTo(id: string, position: number): Promise<void> {
  const ids = (await db.topics.orderBy('order').toArray()).map((t) => t.id).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(ids.length, position)), 0, id);
  await reorderTopics(ids);
}

export interface NewItem {
  topicId: string;
  kind: ItemKind;
  url: string | null;
  title: string;
  description?: string;
  siteName?: string;
  author?: string;
  image?: string | null;
  duration?: number | null;
}

export async function addItems(list: NewItem[]): Promise<number> {
  const now = Date.now();
  const rows: Item[] = list.map((n, i) => ({
    id: newId(),
    topicId: n.topicId,
    kind: n.kind,
    url: n.url,
    normUrl: n.url ? normalizeUrl(n.url) : null,
    title: n.title,
    description: n.description ?? '',
    siteName: n.siteName ?? '',
    author: n.author ?? '',
    image: n.image ?? null,
    duration: n.duration ?? null,
    addedAt: now + i, // keeps paste order stable
    doneAt: null,
    snoozedUntil: null,
    dismissed: false,
  }));
  await changed(db.items.bulkAdd(rows));
  return rows.length;
}

export async function setDone(id: string, done: boolean): Promise<void> {
  await changed(db.transaction('rw', db.items, db.topics, async () => {
    const it = await db.items.get(id);
    if (!it) return;
    await db.items.update(id, { doneAt: done ? Date.now() : null, snoozedUntil: null });
    if (done) await db.topics.update(it.topicId, { lastActivityAt: Date.now() });
  }));
}

export const snoozeItem = (id: string, days = 3) => changed(db.items.update(id, { snoozedUntil: Date.now() + days * DAY }));
export const dismissItem = (id: string) => changed(db.items.update(id, { dismissed: true }));
export const restoreItem = (id: string) => changed(db.items.update(id, { dismissed: false, snoozedUntil: null }));
export const moveItem = (id: string, topicId: string) => changed(db.items.update(id, { topicId }));
export const deleteItem = (id: string) => changed(db.items.delete(id));

/* ---- Example data for a first look ---- */

export async function loadExamples(): Promise<void> {
  const ago = (d: number) => Date.now() - d * DAY;
  const spec: [string, number, NewItem[], number[]][] = [
    ['Machine Learning', 3, [
      { topicId: '', kind: 'video', url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY', title: "Let's build GPT: from scratch, in code, spelled out.", siteName: 'YouTube', author: 'Andrej Karpathy', duration: 6980, image: 'https://i.ytimg.com/vi/kCc8FmEb1nY/hqdefault.jpg', description: 'Builds a Generatively Pretrained Transformer following the paper "Attention is All You Need".' },
      { topicId: '', kind: 'link', url: 'https://jalammar.github.io/illustrated-transformer/', title: 'The Illustrated Transformer', siteName: 'jalammar.github.io', author: 'Jay Alammar', description: 'A visual walkthrough of self-attention, multi-head attention and positional encoding.' },
      { topicId: '', kind: 'link', url: 'https://karpathy.ai/zero-to-hero.html', title: 'Neural Networks: Zero to Hero', siteName: 'karpathy.ai', description: 'A course on neural networks that starts with the basics.' },
    ], [34, 34, 12]],
    ['Rust & Systems', 19, [
      { topicId: '', kind: 'link', url: 'https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html', title: 'Understanding Ownership · The Rust Programming Language', siteName: 'doc.rust-lang.org', description: 'Ownership, borrowing and slices: how Rust is memory-safe without a garbage collector.' },
      { topicId: '', kind: 'link', url: 'https://tokio.rs/tokio/tutorial', title: 'Tokio tutorial', siteName: 'tokio.rs', description: 'Build a small Redis client and server while learning async Rust.' },
    ], [52, 9]],
    ['Personal Finance', 41, [
      { topicId: '', kind: 'link', url: 'https://www.bogleheads.org/wiki/Three-fund_portfolio', title: 'Three-fund portfolio', siteName: 'Bogleheads', description: 'Domestic stocks, international stocks and bonds, in three index funds.' },
    ], [63]],
    ['Cooking', 2, [
      { topicId: '', kind: 'note', url: null, title: 'Try the 36-hour sourdough recipe Maria sent', description: '' },
    ], [2]],
  ];
  for (const [name, idle, list, ages] of spec) {
    const topicId = await createTopic(name, name === 'Machine Learning');
    await db.topics.update(topicId, { lastActivityAt: ago(idle) });
    await addItems(list.map((n) => ({ ...n, topicId })));
    const rows = await db.items.where('topicId').equals(topicId).sortBy('addedAt');
    await Promise.all(rows.map((r, i) => db.items.update(r.id, { addedAt: ago(ages[i] ?? 1) + i })));
  }
  const first = (await db.items.toArray()).find((i) => i.title === 'The Illustrated Transformer');
  if (first) await db.items.update(first.id, { doneAt: ago(3) });
  scheduleBackup();
}
