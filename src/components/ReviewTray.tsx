import { useMemo, useState } from 'react';
import { choiceForPath, NEW, newChoiceLabel, type Draft } from '../ingest';
import { folderNamesFrom } from '../lib/parse';
import { flattenTree, indexTree, PATH_SEP } from '../lib/tree';
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
  const single = drafts.length === 1;

  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const newChoices = useMemo(() => [...new Set(drafts.map((d) => d.choice).filter((c) => c.startsWith(NEW)))], [drafts]);
  const tree = useMemo(() => indexTree(topics), [topics]);
  const folders = useMemo(() => flattenTree(topics, tree), [topics, tree]);
  const inbox = tree.children(null).find((t) => t.name.toLowerCase() === 'inbox');
  const included = drafts.filter((d) => d.include && (d.choice || (d.join && d.joinTo)));
  const groups = new Set(included.map((d) => (d.join && d.joinTo ? d.joinTo.topicId : d.choice))).size;
  const newCount = new Set(included.filter((d) => !d.join && d.choice.startsWith(NEW)).map((d) => d.choice)).size;
  const labelOf = (choice: string) => (choice.startsWith(NEW) ? `+ New: ${newChoiceLabel(choice)}` : folders.find((f) => f.topic.id === choice)?.path.join(PATH_SEP) ?? '');
  const joining = (d: Draft) => !!(d.join && d.joinTo);
  const dupCount = drafts.filter((d) => d.source === 'duplicate').length;

  const finishNaming = (key: string) => {
    // A name, or a path like \robotics\papers or "Robotics › Papers"; existing folders are reused.
    const names = folderNamesFrom(newName);
    if (names.length) update(key, { choice: choiceForPath(names, tree), include: true });
    setNaming(null);
    setNewName('');
  };

  return (
    <div className="tray" role="region" aria-label="Review sorted items">
      <h3>
        {single
          ? joining(drafts[0])
            ? 'Add to an item you already have'
            : 'One item → where should it go?'
          : `${included.length} item${included.length === 1 ? '' : 's'} → ${groups} topic${groups === 1 ? '' : 's'}`}
      </h3>
      <div className="sub">
        {newCount > 0 && `${newCount} new topic${newCount === 1 ? '' : 's'} suggested. `}
        {dupCount > 0 && `${dupCount} already saved (unchecked). `}
        {aiCount > 0 && model ? `${single ? 'Placed' : 'Grouped and sorted'} by ${model}. ` : ''}
        {single ? 'Check the title and folder, then add.' : 'Change any topic, then add.'}{leftover && ' More text is waiting in the box for the next round.'}
      </div>

      {drafts.map((d) => (
        <div className={`tray-row ${d.include ? '' : 'off'}`} key={d.key}>
          <input type="checkbox" className="check" checked={d.include} onChange={(e) => update(d.key, { include: e.target.checked })} aria-label={`Include ${d.title}`} />
          <span className="ticon" aria-hidden="true">
            {d.kind === 'video' ? '▶' : d.kind === 'note' ? '✎' : '↗'}
          </span>
          <div className="t">
            <b>
              {single ? (
                <input className="title-edit" value={d.title} onChange={(e) => update(d.key, { title: e.target.value })} aria-label="Title" />
              ) : (
                d.title
              )}
              {d.source === 'duplicate' && <span className="tag dup">already in {d.duplicateOf}</span>}
              {d.source === 'history' && <span className="tag">same site as before</span>}
              {d.source === 'path' && <span className="tag path">your folder</span>}
            </b>
            <small>
              {d.links
                ? `${d.links.length} links: ${d.links.map((l) => l.label || l.title || l.siteName).join(' · ')}`
                : d.url ?? 'note'}
            </small>
            {d.description && <small className="snippet">{d.description.length > 140 ? `${d.description.slice(0, 139)}…` : d.description}</small>}
            {d.joinTo && (
              <label className="join">
                <input type="checkbox" checked={!!d.join} onChange={(e) => update(d.key, { join: e.target.checked })} />
                <span>
                  Add to <b>“{d.joinTo.title}”</b>
                  {folders.find((f) => f.topic.id === d.joinTo!.topicId) && <> in {folders.find((f) => f.topic.id === d.joinTo!.topicId)!.path.join(PATH_SEP)}</>}: its links and notes are added there, and it's marked not done again.
                </span>
              </label>
            )}
            {!joining(d) && !!d.alternatives?.length && (
              <div className="alt-picks">
                <span>Or:</span>
                {d.alternatives.map((c) => (
                  <button key={c} type="button" className={`chip ${d.choice === c ? 'on' : ''}`} onClick={() => update(d.key, { choice: c, include: true })}>
                    {labelOf(c)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pick">
            {joining(d) ? (
              <span className="join-note">Stays in its folder</span>
            ) : naming === d.key ? (
              <input
                type="text"
                autoFocus
                placeholder="Name, or \robotics\papers"
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
                {folders.map((f) => (
                  <option key={f.topic.id} value={f.topic.id}>
                    {f.path.join(PATH_SEP)}
                  </option>
                ))}
                {[...new Set([...newChoices, ...(d.alternatives ?? []).filter((c) => c.startsWith(NEW))])].map((c) => (
                  <option key={c} value={c}>
                    + New: {newChoiceLabel(c)}
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
          {single ? (joining(drafts[0]) ? 'Add to item' : 'Add item') : `Add ${included.length} item${included.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
