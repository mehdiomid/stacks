import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app-context';
import { AIError } from '../ai/errors';
import { interpret, type ResolvedAction } from '../ai/interpret';
import { applyActions } from '../ai/actions';
import { acceptDrafts, prepareDrafts, prepareOne, type Draft } from '../ingest';
import { LIMITS, looksLikeInstruction, parseLines, pathsIn, uniqueUrls } from '../lib/parse';
import { flattenTree, MAX_DEPTH, nameKey, PATH_SEP, typedPath } from '../lib/tree';
import { getAISettings } from '../settings';
import type { Item, Topic } from '../types';
import { ReviewTray } from './ReviewTray';
import { InstructionTray } from './InstructionTray';

const COLLAPSE_KEY = 'stacks.composerCollapsed';
/** The folder path being typed right before the caret: \rob, \robotics\pa, \"Machine Lea */
const TYPING_PATH = /(?:^|\s)((?:\\(?:"[^"\n\\]*"?|“[^”\n\\]*”?|[^\s\\"“”]*))+)$/;
const unquote = (s: string) => s.replace(/^["“]|["”]$/g, '');

interface Suggest {
  start: number;
  end: number;
  token: string;
  options: { names: string[]; typed: string }[];
  active: number;
}

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

export function Composer({ topics, items }: { topics: Topic[]; items: Item[] }) {
  const { toast, openSettings } = useApp();
  const [text, setText] = useState('');
  const [override, setOverride] = useState<'add' | 'instr' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ drafts: Draft[]; model: string; aiCount: number; leftover: string } | null>(null);
  const [plan, setPlan] = useState<{ summary: string; actions: ResolvedAction[] } | null>(null);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  /** "Several things": split the paste into items. Off by default, and cleared after each add. */
  const [splitTicked, setSplit] = useState(false);
  // Local mode places one item at a time; splitting and instructions need Claude or OpenAI.
  const ai = useLiveQuery(getAISettings, []);
  const local = ai ? ai.engine === 'local' : true;
  const split = splitTicked && !local;
  const closedFor = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const folderPaths = useMemo(() => flattenTree(topics).map((f) => f.path), [topics]);

  /** Typing \ lists your folders; the list narrows as you type. */
  function updateSuggest(value: string, caret: number) {
    const m = TYPING_PATH.exec(value.slice(0, caret));
    if (!m || m[1] === closedFor.current) return setSuggest(null);
    const token = m[1];
    const segs = token.split('\\').slice(1).map(unquote);
    const done = segs.slice(0, -1).map(nameKey);
    const partial = nameKey(segs[segs.length - 1] ?? '');
    const options = folderPaths
      .filter((p) => p.length > done.length && done.every((d, i) => nameKey(p[i]) === d) && nameKey(p[done.length]).startsWith(partial))
      .slice(0, 6)
      .map((names) => ({ names, typed: typedPath(names) }));
    // Nothing to suggest once the path is typed out in full.
    const exact = options.length === 1 && options[0].names.length === segs.length && nameKey(options[0].names[segs.length - 1]) === partial;
    setSuggest(options.length && !exact ? { start: caret - token.length, end: caret, token, options, active: 0 } : null);
  }

  function pick(i: number) {
    if (!suggest) return;
    const { typed } = suggest.options[i];
    const next = text.slice(0, suggest.start) + typed + text.slice(suggest.end);
    closedFor.current = typed;
    setText(next);
    setSuggest(null);
    const at = suggest.start + typed.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  }

  const isInstr = !local && (override ? override === 'instr' : looksLikeInstruction(text));

  // Local mode: start loading the models while you type, so placing (and proposing a folder) is quicker.
  const typing = text.trim().length > 0;
  useEffect(() => {
    if (!typing || !ai || ai.engine !== 'local') return;
    const t = setTimeout(() => {
      void import('../local/embedder').then((m) => m.embed(['warm up'])).catch(() => {});
      if (ai.suggestFolders) void import('../local/namer').then((m) => m.warmUp());
    }, 800);
    return () => clearTimeout(t);
  }, [typing, ai]);
  const found = useMemo(() => {
    if (isInstr || !text.trim()) return null;
    const lines = parseLines(text);
    return { lines: lines.length, links: uniqueUrls(lines).length, ...pathsIn(text) };
  }, [text, isInstr]);

  const setCollapsed = (c: boolean, focus = false) => {
    setCollapsedState(c);
    try {
      localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0');
    } catch {
      /* not remembered this time */
    }
    if (!c && focus) requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !t.closest('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        setCollapsed(false, true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const fail = (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Something went wrong.';
    setError(msg);
    if (err instanceof AIError && err.needsSettings) openSettings(msg);
  };

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setError(null);
    setReview(null);
    setPlan(null);
    try {
      if (isInstr) {
        setBusy('Reading your instruction…');
        const r = await interpret(value, topics, items);
        setPlan(r);
      } else {
        setBusy(split ? 'Splitting into pieces…' : 'Reading…');
        const r = await (split ? prepareDrafts : prepareOne)(text, setBusy);
        if (!r.drafts.length) setError('Nothing to add was found in that text.');
        else setReview(r);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function accept(drafts: Draft[]) {
    if (!review) return;
    try {
      const n = await acceptDrafts(drafts);
      setText(review.leftover);
      setOverride(null);
      setReview(null);
      if (!review.leftover) setSplit(false);
      const joined = drafts.find((d) => d.include && d.join && d.joinTo);
      toast(
        review.leftover
          ? `Added ${n} items. The rest is still in the box; press Sort it again.`
          : joined && n === 1
            ? `Added to “${joined.joinTo!.title}”`
            : `Added ${n} item${n === 1 ? '' : 's'}`,
      );
    } catch (err) {
      fail(err);
    }
  }

  async function apply() {
    if (!plan) return;
    try {
      await applyActions(plan.actions);
      toast(`Done: ${plan.actions.length} change${plan.actions.length === 1 ? '' : 's'}`);
      setText('');
      setOverride(null);
      setPlan(null);
    } catch (err) {
      fail(err);
    }
  }

  const going = (p: string[]) => (p.length === 1 ? `${p[0]} › a subfolder the AI picks` : p.join(PATH_SEP));
  const counts = found ? `${found.links} link${found.links === 1 ? '' : 's'} and ${found.lines} line${found.lines === 1 ? '' : 's'}. ` : '';
  const hint = busy
    ? null
    : isInstr
      ? 'Read as an instruction. You see the changes before anything happens.'
      : !found
        ? 'Paste anything: it becomes one item. Type \\ to pick a folder.'
        : split
          ? `${counts}${found.paths.length ? `Going to ${found.paths.map(going).join(', ')}.` : 'Related lines become one item, the rest are split.'}${
              found.clipped ? ` Folders go ${MAX_DEPTH} levels deep, so extra levels are dropped.` : ''
            }${found.links > LIMITS.maxLinks ? ` The first ${LIMITS.maxLinks} links are sorted now.` : ''}`
          : `${counts}All of it becomes one item${found.paths.length ? `, going to ${local ? found.paths[0].join(PATH_SEP) + (found.paths[0].length === 1 ? ' › the best subfolder' : '') : going(found.paths[0])}` : ''}.${
              found.paths.length > 1 ? (local ? ' More than one folder is written: the first one is used.' : ' More than one folder is written: tick “Several things” to split, or the first one is used.') : ''
            }${found.clipped ? ` Folders go ${MAX_DEPTH} levels deep, so extra levels are dropped.` : ''}${
              local && looksLikeInstruction(text) ? ' Instructions need Claude or OpenAI (Settings); this is saved as a note.' : ''
            }`;

  return (
    <>
      <div className={`composer ${collapsed ? 'collapsed' : ''}`}>
        {collapsed ? (
          <button className="composer-mini" onClick={() => setCollapsed(false, true)}>
            <span>+ Add links, notes or an instruction…</span>
            <kbd>/</kbd>
          </button>
        ) : (
          <>
            <div className="composer-head">
              {local ? (
                <span className="pill on" title="Local mode: sorted on this device. Splitting and instructions need Claude or OpenAI (Settings).">
                  Add one item · on this device
                </span>
              ) : (
                <button
                  className={`pill ${isInstr ? 'instr' : 'on'}`}
                  onClick={() => setOverride(isInstr ? 'add' : 'instr')}
                  title="Click to switch between adding items and giving an instruction"
                >
                  {isInstr ? 'Instruction' : split ? 'Add items' : 'Add one item'} ⇄
                </button>
              )}
              <button className="collapse" onClick={() => setCollapsed(true)} aria-expanded="true">
                Collapse ▴
              </button>
            </div>
            <textarea
              id="composer-input"
              aria-label="Links, notes or an instruction"
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (!e.target.value.trim()) setOverride(null);
                updateSuggest(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                if (el.selectionStart === el.selectionEnd) updateSuggest(el.value, el.selectionStart);
                else setSuggest(null);
              }}
              onBlur={() => setSuggest(null)}
              aria-controls={suggest ? 'path-suggest' : undefined}
              aria-autocomplete="list"
              onKeyDown={(e) => {
                if (suggest && !e.metaKey && !e.ctrlKey) {
                  const n = suggest.options.length;
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSuggest({ ...suggest, active: (suggest.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
                    return;
                  }
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    pick(suggest.active);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closedFor.current = suggest.token;
                    setSuggest(null);
                    return;
                  }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={'Paste a link, a note, or a whole list of links. Add \\robotics\\papers to choose the folder.\nOr type an instruction, like “move all pizza links to Cooking”.'}
            />
            {suggest && (
              <ul className="path-suggest" id="path-suggest" role="listbox" aria-label="Your folders">
                {suggest.options.map((o, i) => (
                  <li
                    key={o.typed}
                    role="option"
                    aria-selected={i === suggest.active}
                    className={i === suggest.active ? 'active' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(i);
                    }}
                  >
                    <span>{o.names.join(PATH_SEP)}</span>
                    <code>{o.typed}</code>
                  </li>
                ))}
                <li className="path-suggest-help" aria-hidden="true">
                  Tab or Enter to pick · Esc to close
                </li>
              </ul>
            )}
            <div className="composer-bar">
              <div className="mode">{busy ? <span className="status">{busy}</span> : <span>{hint}</span>}</div>
              {!isInstr && !local && (
                <label className="split-toggle" title="Split the paste into separate items, possibly in different folders">
                  <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
                  Several things
                </label>
              )}
              <button className="btn" onClick={() => void submit()} disabled={!text.trim() || !!busy} title="Ctrl/⌘ + Enter">
                {isInstr ? 'Preview changes' : split ? 'Sort it' : 'Add'}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>
      {review && (
        <ReviewTray
          initial={review.drafts}
          topics={topics}
          model={review.model}
          aiCount={review.aiCount}
          leftover={!!review.leftover}
          onAccept={(d) => void accept(d)}
          onCancel={() => setReview(null)}
        />
      )}
      {plan && <InstructionTray plan={plan} topics={topics} items={items} onApply={() => void apply()} onCancel={() => setPlan(null)} />}
    </>
  );
}
