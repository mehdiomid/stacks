import type { Preview } from '../types';

/** Asks the Stacks server for a link's title, description and image. Returns null if it can't. */
export async function fetchPreview(url: string): Promise<Preview | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Preview;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run `fn` over `list` with at most `limit` in flight. */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (t: T, i: number) => Promise<R>, onEach?: (done: number) => void): Promise<R[]> {
  const out = new Array<R>(list.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
      onEach?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}
