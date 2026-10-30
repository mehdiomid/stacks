import { useState } from 'react';
import { useApp } from '../app-context';
import { refreshPreviews } from '../ingest';
import { deleteItem, moveItem, restoreItem, setDone, snoozeItem, updateItem } from '../store';
import { ago, formatDuration } from '../lib/time';
import { domainOf } from '../lib/url';
import type { Item, ItemLink } from '../types';
import { Thumb } from './Thumb';
import type { FolderOption } from './TopicCard';

const LONG = 140;

export function ItemRow({ item, hue, folders }: { item: Item; hue: number; folders: FolderOption[] }) {
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
  // Links are shown only when the item is expanded; a single-link item gets one "Open" row.
  const linkRows: Pick<ItemLink, 'url' | 'label' | 'title' | 'siteName' | 'kind'>[] = item.links?.length
    ? item.links
    : item.url
      ? [{ url: item.url, label: item.kind === 'video' ? 'Watch' : 'Open', title: '', siteName: item.siteName || domainOf(item.url), kind: item.kind === 'video' ? 'video' : 'link' }]
      : [];
  const hasMore = isLong || linkRows.length > 0;
  const toggle = () => hasMore && setExpanded((x) => !x);

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
      <button className="thumb-link" onClick={toggle} tabIndex={-1} aria-hidden="true">
        <Thumb item={item} hue={hue} />
      </button>
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
            <button className={`ititle as-text ${hasMore ? '' : 'static'}`} onClick={toggle} aria-expanded={hasMore ? expanded : undefined}>
              {item.title}
            </button>
            {item.description && (
              <div className={`idesc ${expanded ? 'full' : ''} ${hasMore ? 'clickable' : ''}`} onClick={toggle}>
                {item.description}
              </div>
            )}
            {expanded && linkRows.length > 0 && (
              <ul className="ilinks" aria-label="Links">
                {linkRows.map((l) => (
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
            {hasMore && (
              <button className="linkish small-link" onClick={toggle} aria-expanded={expanded}>
                {expanded ? 'Show less' : linkRows.length > 1 ? `Show more · ${linkRows.length} links` : 'Show more'}
              </button>
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
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
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
