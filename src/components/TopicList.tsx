import { useMemo, useRef, useState } from 'react';
import { useApp } from '../app-context';
import { createTopic, hasExamples, loadExamples, removeExamples, reorderTopics } from '../store';
import type { Item, Topic } from '../types';
import { TopicCard } from './TopicCard';

export function TopicList({ topics, items }: { topics: Topic[]; items: Item[] }) {
  const { toast } = useApp();
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const cards = useRef(new Map<string, HTMLElement>());

  const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const shown = dragOrder ? dragOrder.map((id) => byId.get(id)).filter((t): t is Topic => !!t) : topics;
  const itemsByTopic = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) m.set(it.topicId, [...(m.get(it.topicId) ?? []), it]);
    return m;
  }, [items]);

  const focusHandle = (id: string) => setTimeout(() => cards.current.get(id)?.querySelector<HTMLElement>('.handle')?.focus(), 60);

  /** Pointer-based, so it works with mouse, trackpad and touch. */
  function startDrag(id: string, e: React.PointerEvent) {
    if (e.button > 0) return;
    e.preventDefault();
    const before = topics.findIndex((t) => t.id === id);
    let current = topics.map((t) => t.id);
    setDragOrder(current);
    setDraggingId(id);

    const onMove = (ev: PointerEvent) => {
      const others = current.filter((x) => x !== id);
      let at = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = cards.current.get(others[i])?.getBoundingClientRect();
        if (r && ev.clientY < r.top + r.height / 2) {
          at = i;
          break;
        }
      }
      const next = [...others.slice(0, at), id, ...others.slice(at)];
      if (next.join() !== current.join()) {
        current = next;
        setDragOrder(next);
      }
      if (ev.clientY < 70) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDraggingId(null);
      const after = current.indexOf(id);
      if (after !== before) {
        await reorderTopics(current);
        toast(`${byId.get(id)?.name} is now priority ${after + 1}`);
      }
      setDragOrder(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  async function keyMove(id: string, delta: number) {
    const ids = topics.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderTopics(ids);
    toast(`${byId.get(id)?.name} is now priority ${j + 1}`);
    focusHandle(id);
  }

  async function addTopic() {
    if (!name.trim()) return setAdding(false);
    await createTopic(name);
    setName('');
    setAdding(false);
  }

  return (
    <>
      <div className="section-head">
        <h2>Topics</h2>
        <div className="right">
          {topics.length > 1 && <p>Drag ⋮⋮ to reorder. Higher topics are more important.</p>}
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
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Topic name, like Japanese or Home Repair" aria-label="New topic name" onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
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
        <div className="topics">
          {shown.map((t, i) => (
            <TopicCard
              key={t.id}
              topic={t}
              rank={i + 1}
              items={itemsByTopic.get(t.id) ?? []}
              allTopics={topics}
              dragging={draggingId === t.id}
              cardRef={(el) => {
                if (el) cards.current.set(t.id, el);
                else cards.current.delete(t.id);
              }}
              onHandlePointerDown={(e) => startDrag(t.id, e)}
              onHandleKey={(delta) => void keyMove(t.id, delta)}
            />
          ))}
        </div>
      )}
    </>
  );
}
