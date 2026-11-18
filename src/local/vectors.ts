import { db } from '../db';
import type { Item } from '../types';
import { EMBED_MODEL } from './config';
import { embed } from './embedder';
import { itemText } from './score';

/** FNV-1a: a short fingerprint of the embedded text. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export const textOfItem = (it: Item) => itemText(it.title, it.description);

export interface IndexState {
  /** Items prepared for local sorting, out of all items. */
  done: number;
  total: number;
  running: boolean;
  error: string | null;
}

let state: IndexState = { done: 0, total: 0, running: false, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<IndexState>) => {
  state = { ...state, ...patch };
  listeners.forEach((f) => f());
};
export const getIndexState = () => state;
export function subscribeIndex(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Brings the stored embeddings in line with the items: new and edited items are embedded,
 * deleted ones dropped. Runs in the background; calls while it runs are folded into one more pass.
 */
export function syncVectors(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const [items, vectors] = await Promise.all([db.items.toArray(), db.vectors.toArray()]);
        const byItem = new Map(vectors.map((v) => [v.itemId, v]));
        const live = new Set(items.map((i) => i.id));
        const gone = vectors.filter((v) => !live.has(v.itemId)).map((v) => v.itemId);
        if (gone.length) await db.vectors.bulkDelete(gone);
        const todo = items
          .map((it) => ({ it, text: textOfItem(it) }))
          .filter(({ it, text }) => {
            const v = byItem.get(it.id);
            return !v || v.model !== EMBED_MODEL.id || v.key !== hash(text);
          });
        set({ total: items.length, done: items.length - todo.length, running: todo.length > 0, error: null });
        for (let i = 0; i < todo.length; i += 16) {
          const chunk = todo.slice(i, i + 16);
          const vecs = await embed(chunk.map((c) => c.text));
          await db.vectors.bulkPut(chunk.map((c, k) => ({ itemId: c.it.id, model: EMBED_MODEL.id, key: hash(c.text), vec: vecs[k] })));
          set({ done: state.done + chunk.length });
        }
      } while (again);
      set({ running: false });
    } catch (err) {
      set({ running: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Stored embeddings by item id (only those made by the current model). */
export async function vectorsById(): Promise<Map<string, Float32Array>> {
  const all = await db.vectors.toArray();
  return new Map(all.filter((v) => v.model === EMBED_MODEL.id).map((v) => [v.itemId, v.vec]));
}

/** Folder paths are embedded on demand and kept for the session (there are only a few). */
const pathCache = new Map<string, Float32Array>();
export async function pathVectors(texts: string[]): Promise<Map<string, Float32Array>> {
  const missing = [...new Set(texts)].filter((t) => !pathCache.has(t));
  const vecs = await embed(missing);
  missing.forEach((t, k) => pathCache.set(t, vecs[k]));
  return new Map(texts.map((t) => [t, pathCache.get(t)!]));
}
