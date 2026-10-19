import { useMemo, useState } from 'react';
import { NEW, type Draft } from '../ingest';
import type { Topic } from '../types';

interface Props {
  initial: Draft[];
  topics: Topic[];
  model: string;
  aiCount: number;
  leftover: boolean;
  onAccept: (drafts: Draft[]) => void;
  onCancel: () => void;
}

const NAME_IT = '__name__';

/** Everything the AI suggested, with a topic picker per row. Nothing is saved until "Add". */
export function ReviewTray({ initial, topics, model, aiCount, leftover, onAccept, onCancel }: Props) {
  const [drafts, setDrafts] = useState(initial);
  const [naming, setNaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const newChoices = useMemo(() => [...new Set(drafts.map((d) => d.choice).filter((c) => c.startsWith(NEW)))], [drafts]);
  const inbox = topics.find((t) => t.name.toLowerCase() === 'inbox');
  const included = drafts.filter((d) => d.include && d.choice);
  const groups = new Set(included.map((d) => d.choice)).size;
  const newCount = new Set(included.filter((d) => d.choice.startsWith(NEW)).map((d) => d.choice)).size;
  const dupCount = drafts.filter((d) => d.source === 'duplicate').length;

  const finishNaming = (key: string) => {
    const name = newName.trim();
    if (name) {
      const existing = topics.find((t) => t.name.toLowerCase() === name.toLowerCase());
      update(key, { choice: existing ? existing.id : NEW + name, include: true });
    }
    setNaming(null);
    setNewName('');
  };

  return (
    <div className="tray" role="region" aria-label="Review sorted items">
      <h3>
        {included.length} item{included.length === 1 ? '' : 's'} → {groups} topic{groups === 1 ? '' : 's'}
      </h3>
      <div className="sub">
        {newCount > 0 && `${newCount} new topic${newCount === 1 ? '' : 's'} suggested. `}
        {dupCount > 0 && `${dupCount} already saved (unchecked). `}
        {aiCount > 0 && model ? `Sorted by ${model}. ` : ''}
        Change any topic, then add.{leftover && ' More text is waiting in the box for the next round.'}
      </div>

      {drafts.map((d) => (
        <div className={`tray-row ${d.include ? '' : 'off'}`} key={d.key}>
          <input type="checkbox" className="check" checked={d.include} onChange={(e) => update(d.key, { include: e.target.checked })} aria-label={`Include ${d.title}`} />
          <span className="ticon" aria-hidden="true">
            {d.kind === 'video' ? '▶' : d.kind === 'note' ? '✎' : '↗'}
          </span>
          <div className="t">
            <b>
              {d.title}
              {d.source === 'duplicate' && <span className="tag dup">already in {d.duplicateOf}</span>}
              {d.source === 'history' && <span className="tag">same site as before</span>}
            </b>
            <small>{d.url ?? 'note'}</small>
          </div>
          <div className="pick">
            {naming === d.key ? (
              <input
                type="text"
                autoFocus
                placeholder="New topic name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => finishNaming(d.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishNaming(d.key);
                  if (e.key === 'Escape') setNaming(null);
                }}
                aria-label="New topic name"
              />
            ) : (
              <select
                value={d.choice}
                className={d.choice.startsWith(NEW) ? 'new' : ''}
                aria-label={`Topic for ${d.title}`}
                onChange={(e) => (e.target.value === NAME_IT ? setNaming(d.key) : update(d.key, { choice: e.target.value, include: true }))}
              >
                {!d.choice && <option value="">Choose a topic…</option>}
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {newChoices.map((c) => (
                  <option key={c} value={c}>
                    + New: {c.slice(NEW.length)}
                  </option>
                ))}
                {!inbox && !newChoices.includes(`${NEW}Inbox`) && <option value={`${NEW}Inbox`}>Inbox (sort later)</option>}
                <option value={NAME_IT}>+ New topic…</option>
              </select>
            )}
          </div>
        </div>
      ))}

      <div className="tray-actions">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" onClick={() => onAccept(drafts)} disabled={!included.length}>
          Add {included.length} item{included.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
