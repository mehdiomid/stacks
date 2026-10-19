import { useState } from 'react';
import { useApp } from '../app-context';
import { deleteItem, moveItem, restoreItem, setDone, snoozeItem } from '../store';
import { ago, formatDuration } from '../lib/time';
import type { Item, Topic } from '../types';
import { Thumb } from './Thumb';

export function ItemRow({ item, hue, topics }: { item: Item; hue: number; topics: Topic[] }) {
  const { toast } = useApp();
  const [tools, setTools] = useState(false);
  const snoozed = item.snoozedUntil && item.snoozedUntil > Date.now();
  const meta = [item.siteName, item.author, item.kind === 'video' ? formatDuration(item.duration) : '', `added ${ago(item.addedAt)}`].filter(Boolean);

  return (
    <div className={`item ${item.doneAt ? 'done' : ''}`}>
      <input
        type="checkbox"
        className="check"
        checked={!!item.doneAt}
        onChange={(e) => {
          void setDone(item.id, e.target.checked);
          if (e.target.checked) toast('Marked done. A new star is lit.');
        }}
        aria-label={`Mark “${item.title}” done`}
      />
      <Thumb item={item} hue={hue} />
      <div className="ibody">
        {item.url ? (
          <a className="ititle" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
        ) : (
          <span className="ititle">{item.title}</span>
        )}
        {item.description && <div className="idesc">{item.description}</div>}
        <div className="isrc">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {snoozed && <span>snoozed until {new Date(item.snoozedUntil!).toLocaleDateString()}</span>}
          {item.dismissed && <span>hidden from Up next</span>}
        </div>
        {tools && (
          <div className="item-tools">
            <label className="row">
              Move to
              <select value={item.topicId} onChange={(e) => void moveItem(item.id, e.target.value).then(() => toast('Moved'))}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!item.doneAt && !snoozed && (
              <button className="mini" onClick={() => void snoozeItem(item.id, 7).then(() => toast('Snoozed for a week'))}>
                Snooze a week
              </button>
            )}
            {(item.dismissed || snoozed) && (
              <button className="mini" onClick={() => void restoreItem(item.id)}>
                Show in Up next again
              </button>
            )}
            <button className="mini" onClick={() => void deleteItem(item.id).then(() => toast('Deleted'))}>
              Delete
            </button>
          </div>
        )}
      </div>
      <button className="more" onClick={() => setTools((t) => !t)} aria-label={`More for “${item.title}”`} aria-expanded={tools}>
        ⋯
      </button>
    </div>
  );
}
