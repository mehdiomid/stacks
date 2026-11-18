import { db } from '../db';
import { NAMER_MODEL } from './config';

/** Transformers.js keeps downloaded model files here (Cache API). */
const EMBED_CACHE = 'transformers-cache';

export interface ModelStorage {
  /** Bytes of the embedding model and its runtime kept in this browser. */
  embedBytes: number;
  /** Whether the naming model is kept in this browser. */
  namer: boolean;
  namerBytes: number;
}

export async function modelStorage(): Promise<ModelStorage> {
  let embedBytes = 0;
  try {
    const cache = await caches.open(EMBED_CACHE);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      embedBytes += Number(res?.headers.get('content-length')) || (await res?.clone().blob())?.size || 0;
    }
  } catch {
    /* Cache API unavailable: nothing stored */
  }
  let namer = false;
  try {
    namer = await (await import('./namer')).namerCached();
  } catch {
    namer = false;
  }
  return { embedBytes, namer, namerBytes: namer ? NAMER_MODEL.bytes : 0 };
}

/** Removes the embedding model's files and the prepared items; both come back the next time they're needed. */
export async function removeEmbedModel(): Promise<void> {
  await caches.delete(EMBED_CACHE).catch(() => false);
  await db.vectors.clear();
}

export async function removeNamerModel(): Promise<void> {
  await (await import('./namer')).removeNamer();
}
