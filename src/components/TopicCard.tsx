import { useState } from 'react';
import { deleteTopic, renameTopic, setTopicOpen, setTopicSort } from '../store';
import { daysSince } from '../lib/time';
import type { Item, Topic, TopicSort } from '../types';
import { ItemRow } from './ItemRow';

interface Props {
  topic: Topic;
  rank: number;
  items: Item[];
  allTopics: Topic[];
  dragging: boolean;
  cardRef: (el: HTMLElement | null) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onHandleKey: (delta: number) => void;
}

const SORTS: Record<TopicSort, (a: Item, b: Item) => number> = {
  oldest: (a, b) => a.addedAt - b.addedAt,
  newest: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => a.title.localeCompare(b.title),
};

export function TopicCard({ topic, rank, items, allTopics, dragging, cardRef, onHandlePointerDown, onHandleKey }: Props) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(topic.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = items.filter((i) => !i.doneAt).sort(SORTS[topic.sort]);
  const done = items.filter((i) => i.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const idle = daysSince(topic.lastActivityAt);

  const saveName = async () => {
    if (name.trim() && name.trim() !== topic.name) await renameTopic(topic.id, name);
    setRenaming(false);
    setMenu(false);
  };

  return (
    <section className={`topic ${topic.open ? 'open' : ''} ${dragging ? 'dragging' : ''}`} ref={cardRef} aria-label={topic.name}>
      <div className="topic-head">
        <button
          className="handle"
          aria-label={`Reorder ${topic.name}: drag, or press the up and down arrow keys`}
          title="Drag to reorder"
          onPointerDown={onHandlePointerDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onHandleKey(e.key === 'ArrowUp' ? -1 : 1);
            }
          }}
        >
          ⋮⋮
        </button>
        <span className={`rank r${rank}`} title={`Priority ${rank}`}>
          {rank}
        </span>
        <div className="tname">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
                if (e.key === 'Escape') setRenaming(false);
              }}
              aria-label="Topic name"
            />
          ) : (
            <button onClick={() => void setTopicOpen(topic.id, !topic.open)} aria-expanded={topic.open}>
              {topic.name}
            </button>
          )}
          <div className="tmeta">
            <span>
              {open.length} to go · {done.length}/{items.length} done
            </span>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
            {idle >= 14 && open.length > 0 && <span className="stale">untouched {idle} days</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label={`More for ${topic.name}`} aria-expanded={menu}>
          ⋯
        </button>
        <button className="icon-btn chev" onClick={() => void setTopicOpen(topic.id, !topic.open)} aria-label={`${topic.open ? 'Collapse' : 'Expand'} ${topic.name}`} aria-expanded={topic.open}>
          ▾
        </button>
      </div>

      {menu && (
        <div className="topic-menu">
          {confirmDelete ? (
            <>
              <span>
                Delete {topic.name} and its {items.length} item{items.length === 1 ? '' : 's'}?
              </span>
              <button className="btn danger small" onClick={() => void deleteTopic(topic.id)}>
                Delete
              </button>
              <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          ) : (
            <>
              <button
                className="btn ghost small"
                onClick={() => {
                  setName(topic.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button className="btn ghost small" onClick={() => setConfirmDelete(true)}>
                Delete topic
              </button>
            </>
          )}
        </div>
      )}

      {topic.open && (
        <div className="topic-body">
          {items.length > 1 && (
            <div className="sort">
              <label htmlFor={`sort-${topic.id}`}>Order</label>
              <select id={`sort-${topic.id}`} value={topic.sort} onChange={(e) => void setTopicSort(topic.id, e.target.value as TopicSort)}>
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
                <option value="title">By title</option>
              </select>
            </div>
          )}
          {open.length ? open.map((it) => <ItemRow key={it.id} item={it} hue={topic.hue} topics={allTopics} />) : <p className="empty-topic">{items.length ? 'Everything here is done. Nice work.' : 'Nothing here yet.'}</p>}
          {done.length > 0 && (
            <details className="done-toggle">
              <summary>{done.length} done</summary>
              {done.map((it) => (
                <ItemRow key={it.id} item={it} hue={topic.hue} topics={allTopics} />
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
