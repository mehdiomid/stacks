import type { Item, Topic } from '../types';

/** One encouraging line built from real progress. */
export function Spark({ topics, items }: { topics: Topic[]; items: Item[] }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.doneAt).length;
  let best: { name: string; need: number } | null = null;
  for (const t of topics.slice(0, 3)) {
    const list = items.filter((i) => i.topicId === t.id);
    if (!list.length) continue;
    const need = Math.ceil(list.length / 2) - list.filter((i) => i.doneAt).length;
    if (need > 0 && (!best || need < best.need)) best = { name: t.name, need };
  }
  return (
    <p className="spark">
      <b>{done} finished</b> so far, and each one lights a star behind this page.
      {best && (
        <>
          {' '}
          {best.need} more and <b>{best.name}</b> is halfway done.
        </>
      )}
    </p>
  );
}
