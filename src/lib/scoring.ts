import type { Item, Topic } from '../types';
import { DAY } from './time';

export interface Recommendation {
  item: Item;
  topic: Topic;
  score: number;
  reason: string;
}

/** Small per-day variation so the same items don't win forever, but the list is stable within a day. */
function jitter(id: string, day: string): number {
  let h = 2166136261;
  for (const c of id + day) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export const WEIGHTS = { priority: 0.45, waiting: 0.35, neglect: 0.2, jitter: 0.05 };

/**
 * Score = topic priority (its place in your list)
 *       + how long the item has waited (full weight at 60 days)
 *       + how long since you finished anything in its topic (full weight at 30 days)
 *       + a little daily variation.
 * At most `perTopic` picks come from one topic, so one big list can't crowd out the rest.
 */
export function recommend(topics: Topic[], items: Item[], now = Date.now(), limit = 4, perTopic = 2): Recommendation[] {
  const n = topics.length;
  if (!n) return [];
  const rank = new Map(topics.map((t, i) => [t.id, i]));
  const day = new Date(now).toDateString();

  const scored = items
    .filter((it) => !it.doneAt && !it.dismissed && !(it.snoozedUntil && it.snoozedUntil > now) && rank.has(it.topicId))
    .map((item) => {
      const r = rank.get(item.topicId)!;
      const topic = topics[r];
      const waitDays = Math.max(0, Math.floor((now - item.addedAt) / DAY));
      const idleDays = Math.max(0, Math.floor((now - topic.lastActivityAt) / DAY));
      const priority = 1 - r / n;
      const waiting = Math.min(waitDays / 60, 1);
      const neglect = Math.min(idleDays / 30, 1);
      const score =
        priority * WEIGHTS.priority + waiting * WEIGHTS.waiting + neglect * WEIGHTS.neglect + jitter(item.id, day) * WEIGHTS.jitter;
      // Explain with whichever factor stands out most (neglect is boosted so a forgotten topic gets named).
      const reasons: [number, string][] = [
        [priority * WEIGHTS.priority, r === 0 ? 'Your top topic' : `Priority ${r + 1} topic`],
        [waiting * WEIGHTS.waiting, waitDays <= 1 ? 'Just added' : `Waiting ${waitDays} days`],
        [neglect * WEIGHTS.neglect * 1.75, `${topic.name} untouched ${idleDays} days`],
      ];
      reasons.sort((a, b) => b[0] - a[0]);
      return { item, topic, score, reason: reasons[0][1] };
    })
    .sort((a, b) => b.score - a.score);

  const perCount = new Map<string, number>();
  const out: Recommendation[] = [];
  for (const s of scored) {
    const c = perCount.get(s.topic.id) ?? 0;
    if (c >= perTopic) continue;
    perCount.set(s.topic.id, c + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
