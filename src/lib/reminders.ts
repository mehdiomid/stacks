import { useEffect } from 'react';
import { getSetting, setSetting } from '../db';
import type { Item, Topic } from '../types';
import { recommend } from './scoring';

const MIN_GAP = 20 * 3_600_000;

/** At most one desktop notification a day, while the app is open, for the top "Up next" pick. */
export function useReminders(topics: Topic[] | undefined, items: Item[] | undefined): void {
  useEffect(() => {
    if (!topics || !items) return;
    const check = async () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (!(await getSetting('notify', false))) return;
      if (Date.now() - (await getSetting('lastNotifiedAt', 0)) < MIN_GAP) return;
      const [top] = recommend(topics, items);
      if (!top) return;
      new Notification(`Up next: ${top.item.title}`, { body: `${top.topic.name} · ${top.reason}`, tag: 'stacks-up-next' });
      await setSetting('lastNotifiedAt', Date.now());
    };
    const first = setTimeout(() => void check(), 5000);
    const every = setInterval(() => void check(), 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [topics, items]);
}
