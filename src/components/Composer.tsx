import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app-context';
import { AIError } from '../ai/errors';
import { interpret, type ResolvedAction } from '../ai/interpret';
import { applyActions } from '../ai/actions';
import { acceptDrafts, prepareDrafts, type Draft } from '../ingest';
import { LIMITS, looksLikeInstruction, splitPieces } from '../lib/parse';
import type { Item, Topic } from '../types';
import { ReviewTray } from './ReviewTray';
import { InstructionTray } from './InstructionTray';

const COLLAPSE_KEY = 'stacks.composerCollapsed';
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isInstr = override ? override === 'instr' : looksLikeInstruction(text);
  const pieceCount = useMemo(() => (isInstr || !text.trim() ? 0 : splitPieces(text).length), [text, isInstr]);

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
        setBusy('Splitting into pieces…');
        const r = await prepareDrafts(text, setBusy);
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
      toast(review.leftover ? `Added ${n} items. The rest is still in the box; press Sort it again.` : `Added ${n} item${n === 1 ? '' : 's'}`);
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

  const hint = busy
    ? null
    : isInstr
      ? 'Read as an instruction. You see the changes before anything happens.'
      : pieceCount
        ? `${pieceCount} piece${pieceCount === 1 ? '' : 's'} found${pieceCount > LIMITS.maxPieces ? `; the first ${LIMITS.maxPieces} are sorted now` : ''}`
        : 'Paste anything. Each piece goes to the right topic.';

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
              <button
                className={`pill ${isInstr ? 'instr' : 'on'}`}
                onClick={() => setOverride(isInstr ? 'add' : 'instr')}
                title="Click to switch between adding items and giving an instruction"
              >
                {isInstr ? 'Instruction' : 'Add items'} ⇄
              </button>
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
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={'Paste a link, a note, or a whole list of links.\nOr type an instruction, like “move all pizza links to Cooking”.'}
            />
            <div className="composer-bar">
              <div className="mode">{busy ? <span className="status">{busy}</span> : <span>{hint}</span>}</div>
              <button className="btn" onClick={() => void submit()} disabled={!text.trim() || !!busy} title="Ctrl/⌘ + Enter">
                {isInstr ? 'Preview changes' : 'Sort it'}
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
