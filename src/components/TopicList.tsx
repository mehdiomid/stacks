import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app-context';
import { folderNamesFrom } from '../lib/parse';
import { canNest, descendantIds, flattenTree, indexTree, MAX_DEPTH, PATH_SEP, pathLabel } from '../lib/tree';
import { ensureTopicPath, hasExamples, loadExamples, removeExamples, reorderTopics, setTopicParent } from '../store';
import type { Item, Topic } from '../types';
import { TopicCard, type FolderOption } from './TopicCard';

/** How far the pointer has to move sideways while dragging to go into or out of a folder. */
const NEST_DX = 56;

type Intent = { kind: 'in'; target: string } | { kind: 'out' } | { kind: 'blocked'; why: string } | null;

interface Drag {
  id: string;
  parentId: string | null;
  order: string[];
  intent: Intent;
}

export function TopicList({ topics, items }: { topics: Topic[]; items: Item[] }) {
  const { toast } = useApp();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const cards = useRef(new Map<string, HTMLElement>());

  const tree = useMemo(() => indexTree(topics), [topics]);
  const itemsByTopic = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) m.set(it.topicId, [...(m.get(it.topicId) ?? []), it]);
    return m;
  }, [items]);
  /** Every folder as a choice for "Move to", indented under its parent. */
  const folders: FolderOption[] = useMemo(
    () => flattenTree(topics, tree).map((f) => ({ id: f.topic.id, label: f.path.join(PATH_SEP), depth: f.depth })),
    [topics, tree],
  );

  const nameOf = (id: string | null) => (id ? tree.byId.get(id)?.name ?? '' : '');
  const focusHandle = (id: string) => setTimeout(() => cards.current.get(id)?.querySelector<HTMLElement>('.handle')?.focus(), 60);

  /** Where a folder sits among its siblings after moving it out of its parent: right below the parent. */
  const outOf = (parentId: string) => {
    const parent = tree.byId.get(parentId)!;
    const grand = tree.parentOf(parent);
    return { parentId: grand, position: tree.children(grand).findIndex((t) => t.id === parentId) + 1 };
  };

  async function nestInto(id: string, target: string) {
    await setTopicParent(id, target);
    toast(`${nameOf(id)} is now inside ${nameOf(target)}`);
  }
  async function moveOut(id: string, parentId: string) {
    const to = outOf(parentId);
    await setTopicParent(id, to.parentId, to.position);
    toast(to.parentId ? `${nameOf(id)} moved into ${nameOf(to.parentId)}` : `${nameOf(id)} is now a top-level topic`);
  }

  /** What dragging sideways would do: right goes into the folder above, left goes out of the parent. */
  function intentFor(id: string, parentId: string | null, order: string[], dx: number): Intent {
    if (dx > NEST_DX) {
      const above = order[order.indexOf(id) - 1];
      if (!above) return { kind: 'blocked', why: 'Nothing above to go into' };
      return canNest(id, above, tree) ? { kind: 'in', target: above } : { kind: 'blocked', why: `Folders go ${MAX_DEPTH} levels deep at most` };
    }
    if (dx < -NEST_DX && parentId) return { kind: 'out' };
    return null;
  }

  /** Pointer-based, so it works with mouse, trackpad and touch. Up and down reorders; sideways nests. */
  function startDrag(id: string, e: React.PointerEvent) {
    if (e.button > 0) return;
    e.preventDefault();
    const parentId = tree.parentOf(tree.byId.get(id)!);
    const siblings = tree.children(parentId).map((t) => t.id);
    const before = siblings.indexOf(id);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let state: Drag = { id, parentId, order: siblings, intent: null };
    setDrag(state);

    const onMove = (ev: PointerEvent) => {
      moved ||= Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4;
      const others = state.order.filter((x) => x !== id);
      let at = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = cards.current.get(others[i])?.getBoundingClientRect();
        if (r && ev.clientY < r.top + r.height / 2) {
          at = i;
          break;
        }
      }
      const order = [...others.slice(0, at), id, ...others.slice(at)];
      const intent = intentFor(id, parentId, order, ev.clientX - startX);
      if (order.join() !== state.order.join() || JSON.stringify(intent) !== JSON.stringify(state.intent)) {
        state = { ...state, order, intent };
        setDrag(state);
      }
      if (ev.clientY < 70) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // The click that follows a drag must not open or close the folder it lands on.
      if (moved) {
        const swallow = (ev: MouseEvent) => ev.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      try {
        const { intent, order } = state;
        if (intent?.kind === 'in') await nestInto(id, intent.target);
        else if (intent?.kind === 'out' && parentId) await moveOut(id, parentId);
        else if (order.indexOf(id) !== before) {
          await reorderTopics(order);
          toast(`${nameOf(id)} is now priority ${order.indexOf(id) + 1}${parentId ? ` in ${nameOf(parentId)}` : ''}`);
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'That move did not work.');
      } finally {
        setDrag(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** Arrow keys on the handle: up and down reorder, right goes into the folder above, left goes out. */
  async function keyMove(id: string, key: string) {
    const parentId = tree.parentOf(tree.byId.get(id)!);
    const ids = tree.children(parentId).map((t) => t.id);
    const i = ids.indexOf(id);
    try {
      if (key === 'ArrowRight') {
        const above = ids[i - 1];
        if (!above) return toast('There is no folder above to go into');
        if (!canNest(id, above, tree)) return toast(`Folders go ${MAX_DEPTH} levels deep at most`);
        await nestInto(id, above);
      } else if (key === 'ArrowLeft') {
        if (!parentId) return;
        await moveOut(id, parentId);
      } else {
        const j = i + (key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await reorderTopics(ids);
        toast(`${nameOf(id)} is now priority ${j + 1}${parentId ? ` in ${nameOf(parentId)}` : ''}`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That move did not work.');
    }
    focusHandle(id);
  }

  async function addTopic() {
    const names = folderNamesFrom(name);
    if (!names.length) return setAdding(false);
    try {
      await ensureTopicPath(names);
      setName('');
      setAdding(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that topic.');
    }
  }

  const subtreeItems = (id: string) => [id, ...descendantIds(id, tree)].flatMap((x) => itemsByTopic.get(x) ?? []);

  function renderLevel(parentId: string | null, rankPrefix: string): ReactNode {
    const level = tree.children(parentId);
    const shown = drag && drag.parentId === parentId ? drag.order.map((id) => tree.byId.get(id)!).filter(Boolean) : level;
    return shown.map((t, i) => {
      const rank = `${rankPrefix}${i + 1}`;
      const dragging = drag?.id === t.id;
      const hint =
        dragging && drag.intent
          ? drag.intent.kind === 'in'
            ? `→ into ${nameOf(drag.intent.target)}`
            : drag.intent.kind === 'out'
              ? parentId && tree.parentOf(tree.byId.get(parentId)!)
                ? `← out to ${nameOf(tree.parentOf(tree.byId.get(parentId)!))}`
                : '← out to top level'
              : drag.intent.why
          : null;
      return (
        <TopicCard
          key={t.id}
          topic={t}
          rank={rank}
          depth={rank.split('.').length}
          path={pathLabel(t, tree)}
          items={itemsByTopic.get(t.id) ?? []}
          allItems={subtreeItems(t.id)}
          subfolderCount={descendantIds(t.id, tree).length}
          folders={folders}
          moveTargets={folders.filter((f) => canNest(t.id, f.id, tree) && f.id !== tree.parentOf(t))}
          isNested={!!parentId}
          dragging={dragging}
          dragHint={hint}
          dropTarget={drag?.intent?.kind === 'in' && drag.intent.target === t.id}
          cardRef={(el) => {
            if (el) cards.current.set(t.id, el);
            else cards.current.delete(t.id);
          }}
          onHandlePointerDown={(e) => startDrag(t.id, e)}
          onHandleKey={(key) => void keyMove(t.id, key)}
          subfolders={renderLevel(t.id, `${rank}.`)}
        />
      );
    });
  }

  return (
    <>
      <div className="section-head">
        <h2>Topics</h2>
        <div className="right">
          {topics.length > 1 && <p>Drag ⋮⋮ up or down to reorder, right to put inside the topic above, left to take out.</p>}
          <button className="linkish" onClick={() => setAdding(true)}>
            + New topic
          </button>
        </div>
      </div>
      {adding && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void addTopic();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Topic name, like Japanese, or a path like \robotics\papers"
            aria-label="New topic name"
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          />
          <button className="btn small" type="submit">
            Add
          </button>
          <button className="btn ghost small" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}
      {hasExamples(topics, items) && (
        <div className="example-banner" role="note">
          <p>
            <b>You're looking at example topics.</b> When you're ready to build your own stacks, remove them. Anything you added yourself stays.
          </p>
          <button
            className="btn small"
            onClick={() =>
              void removeExamples().then((r) => toast(`Removed ${r.items} example item${r.items === 1 ? '' : 's'}${r.topics ? ` and ${r.topics} topic${r.topics === 1 ? '' : 's'}` : ''}`))
            }
          >
            Remove examples
          </button>
        </div>
      )}
      {!topics.length ? (
        <div className="empty">
          <h3>Your stacks are empty</h3>
          <p>Paste links or notes in the box above and Stacks will sort them into topics. Or load a few example topics to look around first.</p>
          <button className="btn ghost" onClick={() => void loadExamples().then(() => toast('Example topics added. Press “Remove examples” when you’re done looking.'))}>
            Load example topics
          </button>
        </div>
      ) : (
        <div className="topics">{renderLevel(null, '')}</div>
      )}
    </>
  );
}
