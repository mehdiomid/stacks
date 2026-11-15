import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { choiceForPath, NEW, newChoiceLabel, newChoiceNames, type Draft } from '../ingest';
import { folderNamesFrom } from '../lib/parse';
import { findByName, flattenTree, indexTree, pathOf, PATH_SEP, resolvePath, type TreeIndex } from '../lib/tree';
import type { NamerPhase } from '../local/namer';
import { getAISettings } from '../settings';
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

/** A choice as you'd type it: "Robotics › Papers". */
function pathTextOf(choice: string, tree: TreeIndex): string {
  if (!choice) return '';
  if (choice.startsWith(NEW)) return newChoiceNames(choice).join(PATH_SEP);
  const t = tree.byId.get(choice);
  return t ? pathOf(t, tree).map((x) => x.name).join(PATH_SEP) : '';
}

/** What you typed in the Folder box: an existing folder (by path or name), or the path to create. */
function choiceFromText(text: string, topics: Topic[], tree: TreeIndex): string {
  const names = folderNamesFrom(text);
  if (!names.length) return '';
  const found = findByName(text, topics, tree);
  return found ? found.id : choiceForPath(names, tree);
}

/** What was sorted, with the folder for each. Nothing is saved until "Add". */
export function ReviewTray({ initial, topics, model, aiCount, leftover, onAccept, onCancel }: Props) {
  const [drafts, setDrafts] = useState(initial);
  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const tree = useMemo(() => indexTree(topics), [topics]);
  const folders = useMemo(() => flattenTree(topics, tree), [topics, tree]);
  const included = drafts.filter((d) => d.include && (d.choice || (d.join && d.joinTo)));
  const actions = (
    <div className="tray-actions">
      <button className="btn ghost" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn" onClick={() => onAccept(drafts)} disabled={!included.length}>
        {drafts.length === 1 ? (drafts[0].join && drafts[0].joinTo ? 'Add to item' : 'Add item') : `Add ${included.length} item${included.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );

  if (drafts.length === 1)
    return (
      <div className="tray" role="region" aria-label="Review the new item">
        <OneItem draft={drafts[0]} topics={topics} tree={tree} folders={folders} model={model} aiCount={aiCount} onChange={(patch) => update(drafts[0].key, patch)} />
        {actions}
      </div>
    );
  return (
    <div className="tray" role="region" aria-label="Review sorted items">
      <ManyItems drafts={drafts} included={included} tree={tree} folders={folders} model={model} aiCount={aiCount} leftover={leftover} update={update} />
      {actions}
    </div>
  );
}

/* ---------- one item: Folder (pre-filled), quick picks, Title ---------- */

type FolderState =
  /** Filled with a good existing match, a path you typed, or the AI's pick. */
  | 'picked'
  /** Nothing fits well: the box stays empty while the small model proposes a new folder. */
  | 'waiting'
  /** A proposed new folder fills the box. */
  | 'proposed'
  /** Nothing fits well and no proposal came: the closest folder is filled in. */
  | 'closest';

function OneItem(props: {
  draft: Draft;
  topics: Topic[];
  tree: TreeIndex;
  folders: ReturnType<typeof flattenTree>;
  model: string;
  aiCount: number;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { draft: d, topics, tree, folders, model, aiCount, onChange } = props;
  const suggestOn = useLiveQuery(async () => (await getAISettings()).suggestFolders, []);
  const joining = !!(d.join && d.joinTo);
  // A weak match isn't worth showing: the box waits empty for a proposal instead.
  const waitsAtFirst = !!d.newFolder?.preselect && !joining;
  const [text, setText] = useState(() => (waitsAtFirst ? '' : pathTextOf(d.choice, tree)));
  const [state, setState] = useState<FolderState>(waitsAtFirst ? 'waiting' : 'picked');
  const [phase, setPhase] = useState<NamerPhase | null>(null);
  const touched = useRef(false);
  const started = useRef(false);
  /** The best existing folder, kept as a quick pick. */
  const first = useRef(d.choice);

  const setFolder = (value: string, byYou = true) => {
    if (byYou) touched.current = true;
    setText(value);
    onChange({ choice: choiceFromText(value, topics, tree), include: true });
  };

  /** Without a proposal, the closest existing folder is better than nothing. */
  const fillClosest = () => {
    if (!touched.current) setFolder(pathTextOf(first.current, tree), false);
    setState(touched.current ? 'picked' : 'closest');
  };

  /** Asks the small model for a new "Area › Subfolder" and puts it in the box (unless you typed meanwhile). */
  const propose = () => {
    if (!d.newFolder) return;
    touched.current = false;
    setText('');
    onChange({ choice: '' });
    setState('waiting');
    setPhase(null);
    void import('../local/namer')
      .then(({ suggestFolderPath }) => suggestFolderPath(d.newFolder!.text, d.newFolder!.areas, setPhase))
      .then((names) => {
        if (touched.current) return setState('picked');
        if (!names) return fillClosest();
        setFolder(names.join(PATH_SEP), false);
        setState('proposed');
      })
      .catch(fillClosest);
  };

  // Nothing fits well: wait for a proposed folder, or (proposals off) fill in the closest one.
  useEffect(() => {
    if (!waitsAtFirst) return;
    onChange({ choice: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (started.current || suggestOn === undefined || !waitsAtFirst) return;
    started.current = true;
    if (suggestOn) propose();
    else fillClosest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestOn]);

  const resolved = resolvePath(folderNamesFrom(text), tree);
  const isNew = d.choice.startsWith(NEW);
  const picks = [...new Set([first.current, ...(d.alternatives ?? [])])].filter((c) => c && c !== d.choice);
  const busy = state === 'waiting';
  const canPropose = !!d.newFolder && !!suggestOn && !busy && !isNew;

  let hint: string;
  if (busy)
    hint = `No existing folder fits well. ${
      phase?.phase === 'download'
        ? `Downloading the small model (first time only)… ${phase.pct}%`
        : phase?.phase === 'load'
          ? 'Loading the small model…'
          : phase?.phase === 'prepare'
            ? `Getting the small model ready (${phase.device === 'gpu' ? 'GPU' : 'CPU'})…`
            : phase?.phase === 'run'
              ? `Running the small model on the ${phase.device === 'gpu' ? 'GPU' : 'CPU'} to propose a new folder…`
              : 'Starting the small model…'
    } You can also type a folder or pick one below.`;
  else if (!text.trim()) hint = 'Type a folder, or pick one below.';
  else if (isNew)
    hint =
      newChoiceNames(d.choice).length === 1
        ? 'New top-level folder. Folders are usually Area › Subfolder.'
        : `${state === 'proposed' ? 'Proposed new folder' : 'New folder'}: creates ${resolved.missing.join(PATH_SEP)}${
            resolved.topic ? ` inside ${pathOf(resolved.topic, tree).map((t) => t.name).join(PATH_SEP)}` : ''
          }. Change it if it’s not right.`;
  else if (state === 'closest') hint = 'Nothing fits well; this is the closest folder. Type a new Area › Subfolder to create one.';
  else hint = 'Existing folder.';

  return (
    <>
      <h3>{joining ? 'Add to an item you already have' : 'One item → where should it go?'}</h3>
      <div className="sub">
        {aiCount > 0 && model ? `Placed by ${model}. ` : ''}
        {d.source === 'duplicate' && `Already saved in ${d.duplicateOf} (unchecked). `}
        Check the folder, then add.
      </div>

      {d.joinTo && (
        <label className="join">
          <input type="checkbox" checked={!!d.join} onChange={(e) => onChange({ join: e.target.checked })} />
          <span>
            Add to <b>“{d.joinTo.title}”</b>
            {pathTextOf(d.joinTo.topicId, tree) && <> in {pathTextOf(d.joinTo.topicId, tree)}</>}: its links and notes are added there, and it's marked not done again.
          </span>
        </label>
      )}

      <div className="one-item">
        <label className="field-label" htmlFor="tray-folder">
          Folder
        </label>
        {joining ? (
          <p className="stays">Stays in {pathTextOf(d.joinTo!.topicId, tree)}</p>
        ) : (
          <div>
            <div className={`folder-input ${isNew ? 'new' : ''} ${busy ? 'waiting' : ''}`}>
              <input
                id="tray-folder"
                list="tray-folders"
                value={text}
                placeholder={busy ? 'Proposing a folder…' : 'Area › Subfolder'}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setFolder(e.target.value);
                  if (busy) setState('picked');
                }}
              />
              {isNew && <span className="tag new-tag">new</span>}
              {busy && <span className="spinner" aria-hidden="true" />}
            </div>
            <datalist id="tray-folders">
              {folders.map((f) => (
                <option key={f.topic.id} value={f.path.join(PATH_SEP)} />
              ))}
            </datalist>
            <small className={`folder-hint ${isNew ? 'new' : ''}`} aria-live="polite">
              {hint}
            </small>
            {(picks.length > 0 || canPropose) && (
              <div className="alt-picks">
                <span>Or:</span>
                {picks.map((c) => (
                  <button key={c} type="button" className="chip" onClick={() => setFolder(pathTextOf(c, tree))}>
                    {pathTextOf(c, tree)}
                  </button>
                ))}
                {canPropose && (
                  <button type="button" className="chip new" onClick={propose}>
                    + Propose a new folder
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <label className="field-label" htmlFor="tray-title">
          Title
        </label>
        <div>
          <input id="tray-title" className="title-edit" value={d.title} onChange={(e) => onChange({ title: e.target.value })} />
          <small className="item-meta">
            {d.kind === 'video' ? '▶ ' : d.kind === 'note' ? '✎ ' : '↗ '}
            {d.links ? `${d.links.length} links: ${d.links.map((l) => l.label || l.title || l.siteName).join(' · ')}` : d.url ?? 'note'}
          </small>
          {d.description && <small className="snippet">{d.description.length > 160 ? `${d.description.slice(0, 159)}…` : d.description}</small>}
        </div>
      </div>
    </>
  );
}

/* ---------- several items ("Several things", with Claude or OpenAI): compact rows ---------- */

function ManyItems(props: {
  drafts: Draft[];
  included: Draft[];
  tree: TreeIndex;
  folders: ReturnType<typeof flattenTree>;
  model: string;
  aiCount: number;
  leftover: boolean;
  update: (key: string, patch: Partial<Draft>) => void;
}) {
  const { drafts, included, tree, folders, model, aiCount, leftover, update } = props;
  const [naming, setNaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const newChoices = [...new Set(drafts.map((d) => d.choice).filter((c) => c.startsWith(NEW)))];
  const inbox = tree.children(null).find((t) => t.name.toLowerCase() === 'inbox');
  const groups = new Set(included.map((d) => (d.join && d.joinTo ? d.joinTo.topicId : d.choice))).size;
  const newCount = new Set(included.filter((d) => !d.join && d.choice.startsWith(NEW)).map((d) => d.choice)).size;
  const dupCount = drafts.filter((d) => d.source === 'duplicate').length;

  const finishNaming = (key: string) => {
    // A name, or a path like \robotics\papers or "Robotics › Papers"; existing folders are reused.
    const names = folderNamesFrom(newName);
    if (names.length) update(key, { choice: choiceForPath(names, tree), include: true });
    setNaming(null);
    setNewName('');
  };

  return (
    <>
      <h3>
        {included.length} item{included.length === 1 ? '' : 's'} → {groups} topic{groups === 1 ? '' : 's'}
      </h3>
      <div className="sub">
        {newCount > 0 && `${newCount} new topic${newCount === 1 ? '' : 's'} suggested. `}
        {dupCount > 0 && `${dupCount} already saved (unchecked). `}
        {aiCount > 0 && model ? `Grouped and sorted by ${model}. ` : ''}
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
              {d.source === 'path' && <span className="tag path">your folder</span>}
            </b>
            <small>{d.links ? `${d.links.length} links: ${d.links.map((l) => l.label || l.title || l.siteName).join(' · ')}` : d.url ?? 'note'}</small>
            {d.description && <small className="snippet">{d.description.length > 140 ? `${d.description.slice(0, 139)}…` : d.description}</small>}
          </div>
          <div className="pick">
            {naming === d.key ? (
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
                {newChoices.map((c) => (
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
    </>
  );
}
