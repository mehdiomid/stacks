import { useState, type CSSProperties, type ReactNode } from 'react';
import { createTopic, deleteTopic, renameTopic, setTopicOpen, setTopicParent, setTopicSort } from '../store';
import { daysSince } from '../lib/time';
import { MAX_DEPTH } from '../lib/tree';
import type { Item, Topic, TopicSort } from '../types';
import { ItemRow } from './ItemRow';
import { useApp } from '../app-context';
import { refreshPreviews } from '../ingest';
import { STATIC_HOSTING } from '../lib/hosting';

/** A folder as a choice in a picker. */
export interface FolderOption {
  id: string;
  /** Full path, like "Robotics › Papers". */
  label: string;
  depth: number;
}

interface Props {
  topic: Topic;
  /** "2", or "2.1" for the first folder inside the second. */
  rank: string;
  depth: number;
  path: string;
  /** Items in this folder itself. */
  items: Item[];
  /** Items in this folder and every folder inside it. */
  allItems: Item[];
  subfolderCount: number;
  folders: FolderOption[];
  /** Folders this one may be moved into. */
  moveTargets: FolderOption[];
  isNested: boolean;
  dragging: boolean;
  dragHint: string | null;
  dropTarget: boolean;
  cardRef: (el: HTMLElement | null) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onHandleKey: (key: string) => void;
  subfolders: ReactNode;
}

const SORTS: Record<TopicSort, (a: Item, b: Item) => number> = {
  oldest: (a, b) => a.addedAt - b.addedAt,
  newest: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => a.title.localeCompare(b.title),
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function TopicCard(p: Props) {
  const { topic, rank, depth, items, allItems, subfolderCount, folders, moveTargets, isNested } = p;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(topic.name);
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const { toast } = useApp();

  async function refreshAll() {
    setRefreshing(0);
    const n = await refreshPreviews(items, (done) => setRefreshing(done));
    setRefreshing(null);
    toast(n ? `Updated ${n} preview${n === 1 ? '' : 's'}` : 'No better previews found');
  }

  async function addSubfolder() {
    const n = subName.trim();
    setAddingSub(false);
    setSubName('');
    setMenu(false);
    if (!n) return;
    await createTopic(n, true, topic.id);
    await setTopicOpen(topic.id, true);
  }

  async function moveInto(target: string) {
    try {
      await setTopicParent(topic.id, target || null);
      toast(target ? `${topic.name} is now inside ${folders.find((f) => f.id === target)?.label}` : `${topic.name} is now a top-level topic`);
      setMenu(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That move did not work.');
    }
  }

  const open = items.filter((i) => !i.doneAt).sort(SORTS[topic.sort]);
  const done = items.filter((i) => i.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const allDone = allItems.filter((i) => i.doneAt).length;
  const pct = allItems.length ? Math.round((allDone / allItems.length) * 100) : 0;
  const idle = daysSince(topic.lastActivityAt);
  const topRank = rank.includes('.') ? '' : `r${rank}`;

  const saveName = async () => {
    if (name.trim() && name.trim() !== topic.name) await renameTopic(topic.id, name);
    setRenaming(false);
    setMenu(false);
  };

  return (
    <section
      className={`topic d${depth} ${isNested ? 'nested' : ''} ${topic.open ? 'open' : ''} ${p.dragging ? 'dragging' : ''} ${p.dropTarget ? 'drop-target' : ''}`}
      style={{ '--h': topic.hue } as CSSProperties}
      ref={p.cardRef}
      aria-label={p.path}
    >
      <div
        className="topic-head"
        onClick={(e) => {
          // The whole row opens and closes the topic; its own buttons and inputs keep their jobs.
          if ((e.target as HTMLElement).closest('button, input, a, select')) return;
          void setTopicOpen(topic.id, !topic.open);
        }}
      >
        <button
          className="handle"
          aria-label={`Move ${topic.name}: drag, or use the arrow keys. Up and down reorder, right puts it inside the topic above, left takes it out.`}
          title="Drag up or down to reorder, right to put inside the topic above, left to take out"
          onPointerDown={p.onHandlePointerDown}
          onKeyDown={(e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault();
              p.onHandleKey(e.key);
            }
          }}
        >
          ⋮⋮
        </button>
        <span className={`rank ${topRank}`} title={`Priority ${rank}`}>
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
              {allItems.length - allDone} to go · {allDone}/{allItems.length} done
            </span>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
            {subfolderCount > 0 && <span>{plural(subfolderCount, 'subfolder')}</span>}
            {idle >= 14 && allItems.length > allDone && <span className="stale">untouched {idle} days</span>}
            {p.dragHint && <span className="drag-hint">{p.dragHint}</span>}
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
            subfolderCount > 0 ? (
              <>
                <span>
                  Delete {topic.name}? It has {plural(subfolderCount, 'subfolder')} and {plural(allItems.length, 'item')} in all.
                </span>
                <button className="btn danger small" onClick={() => void deleteTopic(topic.id, 'all')}>
                  Delete everything
                </button>
                <button className="btn ghost small" onClick={() => void deleteTopic(topic.id, 'lift')}>
                  {isNested
                    ? 'Delete only this folder, move what’s in it up'
                    : `Delete only this folder${items.length ? ` and its ${plural(items.length, 'item')}` : ''}, keep subfolders`}
                </button>
                <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <>
                <span>
                  Delete {topic.name} and its {plural(items.length, 'item')}?
                </span>
                <button className="btn danger small" onClick={() => void deleteTopic(topic.id)}>
                  Delete
                </button>
                <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            )
          ) : addingSub ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void addSubfolder();
              }}
            >
              <input autoFocus value={subName} onChange={(e) => setSubName(e.target.value)} placeholder={`Folder inside ${topic.name}`} aria-label="Subfolder name" onKeyDown={(e) => e.key === 'Escape' && setAddingSub(false)} />
              <button className="btn small" type="submit">
                Add
              </button>
            </form>
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
              {depth < MAX_DEPTH && (
                <button className="btn ghost small" onClick={() => setAddingSub(true)}>
                  + Subfolder
                </button>
              )}
              {(moveTargets.length > 0 || isNested) && (
                <label className="row move-into">
                  Move into
                  <select value="" onChange={(e) => void moveInto(e.target.value === '__top' ? '' : e.target.value)} aria-label={`Move ${topic.name} into another topic`}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {isNested && <option value="__top">Top level</option>}
                    {moveTargets.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {items.some((i) => i.url) && !STATIC_HOSTING && (
                <button className="btn ghost small" onClick={() => void refreshAll()} disabled={refreshing !== null}>
                  {refreshing !== null ? `Refreshing ${refreshing}/${items.filter((i) => i.url).length}…` : 'Refresh previews'}
                </button>
              )}
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
          {open.map((it) => (
            <ItemRow key={it.id} item={it} hue={topic.hue} folders={folders} />
          ))}
          {!open.length && !subfolderCount && <p className="empty-topic">{items.length ? 'Everything here is done. Nice work.' : 'Nothing here yet.'}</p>}
          {done.length > 0 && (
            <details className="done-toggle">
              <summary>{done.length} done</summary>
              {done.map((it) => (
                <ItemRow key={it.id} item={it} hue={topic.hue} folders={folders} />
              ))}
            </details>
          )}
          {subfolderCount > 0 && <div className="subtopics">{p.subfolders}</div>}
        </div>
      )}
    </section>
  );
}
