import { useMemo } from 'react';
import { useApp } from '../app-context';
import { recommend } from '../lib/scoring';
import { formatDuration } from '../lib/time';
import { dismissItem, setDone, snoozeItem } from '../store';
import type { Item, Topic } from '../types';
import { Thumb } from './Thumb';

export function UpNext({ topics, items }: { topics: Topic[]; items: Item[] }) {
  const { toast } = useApp();
  const recs = useMemo(() => recommend(topics, items), [topics, items]);
  const open = items.filter((i) => !i.doneAt).length;

  return (
    <section className="panel upnext" aria-labelledby="upnext-title">
      <h2 id="upnext-title">Up next</h2>
      <div className="hint">Picked by topic priority, how long items have waited, and topics you haven't touched lately.</div>
      {recs.length === 0 && <p className="hint">{open ? 'Everything left is snoozed or hidden.' : items.length ? 'All caught up.' : 'Add a few links and your picks show up here.'}</p>}
      {recs.map(({ item, topic, reason }) => (
        <div className="rec" key={item.id}>
          <div className="rec-top">
            <Thumb item={item} hue={topic.hue} />
            <div style={{ minWidth: 0 }}>
              <b>{item.title}</b>
              <small>
                {topic.name}
                {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
              </small>
            </div>
          </div>
          <span className="why">{reason}</span>
          <div className="rec-actions">
            <button
              className="mini ok"
              onClick={() => {
                void setDone(item.id, true);
                toast('Marked done. A new star is lit.');
              }}
            >
              ✓ Done
            </button>
            <button className="mini" onClick={() => void snoozeItem(item.id, 3).then(() => toast('Snoozed for 3 days'))}>
              Snooze 3 days
            </button>
            <button className="mini" onClick={() => void dismissItem(item.id).then(() => toast('It stays in the list but won’t be suggested'))}>
              Not interested
            </button>
            {item.url && (
              <a className="mini" href={item.url} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
