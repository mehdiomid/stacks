import { useState } from 'react';
import { useApp } from '../app-context';
import { refreshPreviews } from '../ingest';
import { deleteItem, moveItem, restoreItem, setDone, snoozeItem, updateItem } from '../store';
import { ago, formatDuration } from '../lib/time';
import type { Item, Topic } from '../types';
import { Thumb } from './Thumb';

const LONG = 140;

export function ItemRow({ item, hue, topics }: { item: Item; hue: number; topics: Topic[] }) {
  const { toast } = useApp();
  const [tools, setTools] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [refreshing, setRefreshing] = useState(false);
  const snoozed = item.snoozedUntil && item.snoozedUntil > Date.now();
  const meta = [item.siteName, item.author, item.kind === 'video' ? formatDuration(item.duration) : '', `added ${ago(item.addedAt)}`].filter(Boolean);
  const isLong = item.description.length > LONG || item.description.includes('\n');

  async function saveEdit() {
    await updateItem(item.id, { title: title.trim() || item.title, description: description.trim() });
    setEditing(false);
    toast('Saved');
  }

  async function refresh() {
    setRefreshing(true);
    const n = await refreshPreviews([item]);
    setRefreshing(false);
    toast(n ? 'Preview updated' : 'No better preview found for this link');
  }

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
      {item.url ? (
        <a className="thumb-link" href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          <Thumb item={item} hue={hue} />
        </a>
      ) : (
        <button className="thumb-link" onClick={() => setExpanded((x) => !x)} tabIndex={-1} aria-hidden="true">
          <Thumb item={item} hue={hue} />
        </button>
      )}
      <div className="ibody">
        {editing ? (
          <form
            className="edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" autoFocus />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Notes or description" rows={3} placeholder="Notes or description" />
            <div className="row">
              <button className="btn small" type="submit">
                Save
              </button>
              <button className="btn ghost small" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {item.url ? (
              <a className="ititle" href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title} <span className="ext" aria-hidden="true">↗</span>
              </a>
            ) : (
              <button className="ititle as-text" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
                {item.title}
              </button>
            )}
            {item.description && (
              <div className={`idesc ${expanded ? 'full' : ''} ${isLong ? 'clickable' : ''}`} onClick={() => isLong && setExpanded((x) => !x)}>
                {item.description}
              </div>
            )}
            {isLong && (
              <button className="linkish small-link" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {item.links && item.links.length > 1 && (
              <ul className="ilinks" aria-label="Links">
                {item.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      <span className="lk" aria-hidden="true">
                        {l.kind === 'video' ? '▶' : '↗'}
                      </span>
                      <b>{l.label || l.title || l.siteName}</b>
                      {l.label && l.title && <span className="lt"> — {l.title}</span>}
                      <span className="ls"> · {l.siteName}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="isrc">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {snoozed && <span>snoozed until {new Date(item.snoozedUntil!).toLocaleDateString()}</span>}
          {item.dismissed && <span>hidden from Up next</span>}
        </div>
        {tools && (
          <div className="item-tools">
            <button
              className="mini"
              onClick={() => {
                setTitle(item.title);
                setDescription(item.description);
                setEditing(true);
                setTools(false);
              }}
            >
              Edit
            </button>
            {item.url && (
              <button className="mini" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh preview'}
              </button>
            )}
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
