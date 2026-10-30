import { db, newId } from './db';
import { scheduleBackup } from './lib/backup';
import { DAY } from './lib/time';
import { normalizeUrl } from './lib/url';
import { canNest, childNamed, descendantIds, indexTree, MAX_DEPTH, pathOf } from './lib/tree';
import type { Item, ItemKind, ItemLink, Topic, TopicSort } from './types';

/** All writes go through here so the folder backup runs after each change. */

const HUES = [232, 18, 188, 140, 36, 330, 268, 200, 0, 96, 300, 160];

async function changed<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  scheduleBackup();
  return r;
}

/** Creates a folder, or returns the one with the same name already in that place. */
export async function createTopic(name: string, open = true, parentId: string | null = null): Promise<string> {
  const all = await db.topics.toArray();
  const tree = indexTree(all);
  const existing = childNamed(parentId, name.trim(), tree);
  if (existing) return existing.id;
  const parent = parentId ? tree.byId.get(parentId) : undefined;
  if (parent && pathOf(parent, tree).length >= MAX_DEPTH) throw new Error(`Folders go ${MAX_DEPTH} levels deep at most.`);
  const now = Date.now();
  const topic: Topic = {
    id: newId(),
    name: name.trim(),
    ...(parent ? { parentId: parent.id } : {}),
    order: tree.children(parent?.id ?? null).reduce((m, t) => Math.max(m, t.order), -1) + 1,
    // Subfolders share their top folder's color.
    hue: parent ? pathOf(parent, tree)[0].hue : HUES[tree.children(null).length % HUES.length],
    createdAt: now,
    lastActivityAt: now,
    open,
    sort: 'oldest',
  };
  await changed(db.topics.add(topic));
  return topic.id;
}

/** Finds or creates each folder along a path, like \robotics\papers. Returns the last one. */
export async function ensureTopicPath(names: string[], open = true): Promise<string> {
  let parentId: string | null = null;
  for (const name of names.slice(0, MAX_DEPTH)) parentId = await createTopic(name, open, parentId);
  if (!parentId) throw new Error('A folder needs a name.');
  return parentId;
}

export const renameTopic = (id: string, name: string) => changed(db.topics.update(id, { name: name.trim() }));
export const setTopicOpen = (id: string, open: boolean) => db.topics.update(id, { open });
export const setTopicSort = (id: string, sort: TopicSort) => db.topics.update(id, { sort });

/**
 * 'all' deletes the folder, its subfolders and every item in them.
 * 'lift' deletes only the folder: its subfolders and items move up into its parent
 * (at the top level there is nowhere for items to go, so they are deleted; subfolders become top-level).
 */
export async function deleteTopic(id: string, mode: 'all' | 'lift' = 'all'): Promise<void> {
  await changed(
    db.transaction('rw', db.topics, db.items, async () => {
      const tree = indexTree(await db.topics.toArray());
      const topic = tree.byId.get(id);
      if (!topic) return;
      if (mode === 'all') {
        const ids = [id, ...descendantIds(id, tree)];
        await db.items.where('topicId').anyOf(ids).delete();
        await db.topics.bulkDelete(ids);
        return;
      }
      const parentId = tree.parentOf(topic);
      if (parentId) await db.items.where('topicId').equals(id).modify({ topicId: parentId });
      else await db.items.where('topicId').equals(id).delete();
      // The subfolders take the deleted folder's place among its siblings.
      const siblings = tree.children(parentId).flatMap((t) => (t.id === id ? tree.children(id) : [t]));
      await Promise.all(siblings.map((t, order) => db.topics.update(t.id, { order, parentId })));
      await db.topics.delete(id);
    }),
  );
}

/** Saves a new order for folders that share a parent. `ids` lists them, most important first. */
export async function reorderTopics(ids: string[]): Promise<void> {
  await changed(db.transaction('rw', db.topics, async () => {
    await Promise.all(ids.map((id, order) => db.topics.update(id, { order })));
  }));
}

/** Moves a folder to a 0-based position among its siblings. */
export async function moveTopicTo(id: string, position: number): Promise<void> {
  const all = await db.topics.toArray();
  const tree = indexTree(all);
  const t = tree.byId.get(id);
  if (!t) return;
  const ids = tree.children(tree.parentOf(t)).map((x) => x.id).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(ids.length, position)), 0, id);
  await reorderTopics(ids);
}

/**
 * Puts a folder (with everything inside it) into another folder, or at the top level with null.
 * `position` is its 0-based place among its new siblings; the end when left out.
 */
export async function setTopicParent(id: string, parentId: string | null, position?: number): Promise<void> {
  await changed(db.transaction('rw', db.topics, async () => {
    const all = await db.topics.toArray();
    const tree = indexTree(all);
    const t = tree.byId.get(id);
    if (!t) return;
    if (!canNest(id, parentId, tree)) throw new Error(`That would make folders more than ${MAX_DEPTH} levels deep.`);
    const ids = tree.children(parentId).map((x) => x.id).filter((x) => x !== id);
    ids.splice(position === undefined ? ids.length : Math.max(0, Math.min(ids.length, position)), 0, id);
    const parent = parentId ? tree.byId.get(parentId)! : null;
    const hue = parent ? pathOf(parent, tree)[0].hue : t.hue;
    await Promise.all(ids.map((x, order) => db.topics.update(x, x === id ? { order, parentId, hue } : { order })));
    for (const d of descendantIds(id, tree)) await db.topics.update(d, { hue });
    // Close the gap it left among its old siblings.
    const old = tree.children(tree.parentOf(t)).filter((x) => x.id !== id);
    if (tree.parentOf(t) !== parentId) await Promise.all(old.map((x, order) => db.topics.update(x.id, { order })));
    if (parent) await db.topics.update(parent.id, { open: true });
  }));
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
  links?: ItemLink[];
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
    ...(n.links?.length ? { links: n.links } : {}),
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
    if (!done) return;
    // Finishing something in a subfolder counts as activity in the folders around it too.
    const tree = indexTree(await db.topics.toArray());
    const t = tree.byId.get(it.topicId);
    if (t) await Promise.all(pathOf(t, tree).map((x) => db.topics.update(x.id, { lastActivityAt: Date.now() })));
  }));
}

export const snoozeItem = (id: string, days = 3) => changed(db.items.update(id, { snoozedUntil: Date.now() + days * DAY }));
export const dismissItem = (id: string) => changed(db.items.update(id, { dismissed: true }));
export const restoreItem = (id: string) => changed(db.items.update(id, { dismissed: false, snoozedUntil: null }));
export const moveItem = (id: string, topicId: string) => changed(db.items.update(id, { topicId }));
export const deleteItem = (id: string) => changed(db.items.delete(id));
export const updateItem = (id: string, patch: Partial<Item>) => changed(db.items.update(id, patch));

/* ---- Example data for a first look ---- */

type ExampleItem = Omit<NewItem, 'topicId'> & { ageDays: number; done?: boolean };

const EXAMPLES: { name: string; idleDays: number; open: boolean; items: ExampleItem[] }[] = [
  { name: 'Machine Learning', idleDays: 3, open: true, items: [
    { kind: 'video', url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY', title: "Let's build GPT: from scratch, in code, spelled out.", siteName: 'YouTube', author: 'Andrej Karpathy', duration: 6980, image: 'https://i.ytimg.com/vi/kCc8FmEb1nY/hqdefault.jpg', description: 'Builds a Generatively Pretrained Transformer following the paper "Attention is All You Need".', ageDays: 34 },
    { kind: 'link', url: 'https://jalammar.github.io/illustrated-transformer/', title: 'The Illustrated Transformer', siteName: 'jalammar.github.io', author: 'Jay Alammar', description: 'A visual walkthrough of self-attention, multi-head attention and positional encoding.', ageDays: 34, done: true },
    { kind: 'link', url: 'https://karpathy.ai/zero-to-hero.html', title: 'Neural Networks: Zero to Hero', siteName: 'karpathy.ai', description: 'A course on neural networks that starts with the basics.', ageDays: 12 },
  ] },
  { name: 'Rust & Systems', idleDays: 19, open: false, items: [
    { kind: 'link', url: 'https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html', title: 'Understanding Ownership · The Rust Programming Language', siteName: 'doc.rust-lang.org', description: 'Ownership, borrowing and slices: how Rust is memory-safe without a garbage collector.', ageDays: 52 },
    { kind: 'link', url: 'https://tokio.rs/tokio/tutorial', title: 'Tokio tutorial', siteName: 'tokio.rs', description: 'Build a small Redis client and server while learning async Rust.', ageDays: 9 },
  ] },
  { name: 'Personal Finance', idleDays: 41, open: false, items: [
    { kind: 'link', url: 'https://www.bogleheads.org/wiki/Three-fund_portfolio', title: 'Three-fund portfolio', siteName: 'Bogleheads', description: 'Domestic stocks, international stocks and bonds, in three index funds.', ageDays: 63 },
  ] },
  { name: 'Cooking', idleDays: 2, open: false, items: [
    { kind: 'note', url: null, title: 'Try the 36-hour sourdough recipe Maria sent', ageDays: 2 },
  ] },
];

// Recognizes examples loaded before items carried the `example` flag: same link (or note) AND still in its example topic.
const EXAMPLE_HOME = new Map(EXAMPLES.flatMap((t) => t.items.map((i) => [i.url ? normalizeUrl(i.url) : i.title, t.name] as const)));
const EXAMPLE_TOPICS = new Set(EXAMPLES.map((t) => t.name));

export function isExampleItem(it: Item, topics: Topic[]): boolean {
  if (it.example) return true;
  const home = EXAMPLE_HOME.get(it.normUrl ?? it.title);
  return !!home && topics.find((t) => t.id === it.topicId)?.name === home;
}

/** True while any example item is still around. */
export const hasExamples = (topics: Topic[], items: Item[]) => items.some((i) => isExampleItem(i, topics));

export async function loadExamples(): Promise<void> {
  const ago = (d: number) => Date.now() - d * DAY;
  const rows: Item[] = [];
  await db.transaction('rw', db.topics, db.items, async () => {
    for (const spec of EXAMPLES) {
      const topicId = await createTopic(spec.name, spec.open);
      await db.topics.update(topicId, { lastActivityAt: ago(spec.idleDays), example: true });
      spec.items.forEach(({ ageDays, done, ...n }, i) => {
        rows.push({
          id: newId(), topicId, kind: n.kind, url: n.url, normUrl: n.url ? normalizeUrl(n.url) : null, title: n.title,
          description: n.description ?? '', siteName: n.siteName ?? '', author: n.author ?? '', image: n.image ?? null, duration: n.duration ?? null,
          addedAt: ago(ageDays) + i, doneAt: done ? ago(3) : null, snoozedUntil: null, dismissed: false, example: true,
        });
      });
    }
    await db.items.bulkAdd(rows);
  });
  scheduleBackup();
}

/**
 * Removes the example items, and example topics that have nothing of yours in them.
 * An example topic you added your own items or folders to is kept and becomes yours.
 */
export async function removeExamples(): Promise<{ items: number; topics: number }> {
  let removed = { items: 0, topics: 0 };
  await changed(db.transaction('rw', db.topics, db.items, async () => {
    const [items, topics] = await Promise.all([db.items.toArray(), db.topics.toArray()]);
    const exampleIds = items.filter((i) => isExampleItem(i, topics)).map((i) => i.id);
    await db.items.bulkDelete(exampleIds);
    const left = items.filter((i) => !exampleIds.includes(i.id));
    for (const t of topics) {
      if (!t.example && !EXAMPLE_TOPICS.has(t.name)) continue;
      if (left.some((i) => i.topicId === t.id) || topics.some((x) => x.parentId === t.id)) await db.topics.update(t.id, { example: false });
      else if (t.example || items.some((i) => i.topicId === t.id)) {
        await db.topics.delete(t.id);
        removed.topics++;
      }
    }
    removed.items = exampleIds.length;
    // Close the gaps in priority numbers.
    const rest = indexTree(await db.topics.toArray());
    const groups = [null, ...rest.byId.keys()].map((p) => rest.children(p));
    await Promise.all(groups.flatMap((g) => g.map((t, order) => db.topics.update(t.id, { order }))));
  }));
  return removed;
}

/** Deletes every topic and item. Settings, API keys and the backup folder choice stay. */
export async function deleteAllLists(): Promise<void> {
  await changed(db.transaction('rw', db.topics, db.items, async () => {
    await db.items.clear();
    await db.topics.clear();
  }));
}
