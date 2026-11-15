/*
 * Local mode's decisions, as pure functions over vectors (tested in score.test.ts).
 * Numbers come from tests/RESULTS.md, measured for snowflake-arctic-embed-xs.
 */
import type { Item, Topic } from '../types';
import { indexTree, pathOf, type TreeIndex } from '../lib/tree';

/** A folder is described by its path and its latest items, as in the assessment. */
export const LATEST_PER_FOLDER = 5;
/** Below this best score, "+ New folder" is preselected (keeps ~95% of items that do fit in place). */
export const WEAK_MATCH = 0.81;
/** "Add to this item" needs at least this similarity, and a shared distinctive name. */
export const JOIN_MIN = 0.86;
/** …or this much when both titles share a 4-word run that includes a name ("Modern Robot Learning from Scratch"). */
export const JOIN_PHRASE_MIN = 0.75;

export type Vec = Float32Array;

export const dot = (a: Vec, b: Vec) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export function normalize(v: Vec): Vec {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

/** The average direction of several vectors. */
export function centroid(vs: Vec[]): Vec {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  return normalize(out);
}

/** What gets embedded for an item: its title and notes, as in the assessment. */
export const itemText = (title: string, notes: string) => (notes.trim() ? `${title}. ${notes.replace(/\s+/g, ' ').trim()}` : title).slice(0, 600);
export const pathText = (names: string[]) => names.join(' / ');

const isInbox = (t: Topic) => t.name.trim().toLowerCase() === 'inbox';

/**
 * Folders an item can be sorted into: every folder 2 levels deep or more, plus top-level folders
 * that hold items themselves (made before the 2-level rule). Inbox is never a sorting target.
 * With `within`, only that folder's subfolders (a 1-level path you typed, like \robotics).
 */
export function candidateFolders(topics: Topic[], items: Item[], within: string | null = null, tree: TreeIndex = indexTree(topics)): Topic[] {
  const holds = new Set(items.map((i) => i.topicId));
  return topics.filter((t) => {
    if (isInbox(t)) return false;
    const path = pathOf(t, tree);
    if (within) return path.length >= 2 && path[0].id === within;
    return path.length >= 2 || (holds.has(t.id) && !tree.children(t.id).length);
  });
}

/** Latest items of a folder, newest first. */
export function latestIn(topicId: string, items: Item[], n = LATEST_PER_FOLDER): Item[] {
  return items
    .filter((i) => i.topicId === topicId)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, n);
}

export interface Ranked {
  topic: Topic;
  score: number;
}

/** Folders ranked for a paste: similarity to the average of the folder's path and latest items. */
export function rankFolders(q: Vec, folders: Topic[], folderVecs: (t: Topic) => Vec[]): Ranked[] {
  return folders
    .map((topic) => {
      const vs = folderVecs(topic);
      return { topic, score: vs.length ? dot(q, centroid(vs)) : -1 };
    })
    .sort((a, b) => b.score - a.score);
}

/* ---------- "Is this the same course?" ---------- */

/** Words that say what kind of thing an item is, not which one. */
const GENERIC = new Set(
  (
    'a an and the of to for in on with from by vs at is it its how what why your you my our this that ' +
    'lecture lectures course courses part parts unit units episode episodes ep week weeks lesson lessons chapter chapters ' +
    'series introduction intro guide plan tutorial tutorials video videos notes explained basics overview review talk ' +
    'deep learning machine robot robots robotics from scratch new best day module modules session class'
  ).split(' '),
);

const wordList = (t: string) => t.toLowerCase().match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [];
const wordsOf = (t: string) => new Set(wordList(t));

/**
 * Whether two titles share a run of 4 words that isn't all generic: a series name ("modern robot
 * learning from"), not a topic ("vision language action" is only 3) or a stock phrase ("learning from scratch").
 */
export function sharesPhrase(a: string, b: string): boolean {
  const runs = (t: string) => {
    const w = wordList(t);
    return new Set(w.slice(0, -3).map((_, i) => w.slice(i, i + 4)).filter((g) => g.some((x) => !GENERIC.has(x) && !/^\d+$/.test(x))).map((g) => g.join(' ')));
  };
  const mine = runs(a);
  return [...runs(b)].some((r) => mine.has(r));
}

/** How many saved titles each word appears in: a name is a word few titles share. */
export function titleFrequency(titles: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of titles) for (const w of wordsOf(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return df;
}

/** Distinctive words: not generic, not a bare number, and in at most 3 saved titles ("cs231n", "rustlings"). */
export function distinctiveWords(text: string, df: Map<string, number>): Set<string> {
  return new Set([...wordsOf(text)].filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w) && (df.get(w) ?? 0) <= 3));
}

/** Course-code-like words: letters and digits together ("cs231n", "6.s191", "5k"). */
export const codesIn = (t: string) => new Set([...wordsOf(t)].filter((w) => /[a-z]/.test(w) && /\d/.test(w)));

/**
 * The saved item a paste continues, if any: very similar AND sharing a distinctive name.
 * Similarity alone mixes up similar courses (CS234 vs CS285); the name check is what makes this work.
 */
export function joinCandidate(q: Vec, pasteText: string, shown: Item[], vecOf: (id: string) => Vec | undefined, df: Map<string, number>): { item: Item; sim: number } | null {
  const mine = distinctiveWords(pasteText, df);
  if (!mine.size) return null;
  const myCodes = codesIn(pasteText);
  let best: { item: Item; sim: number } | null = null;
  for (const it of shown) {
    const v = vecOf(it.id);
    if (!v) continue;
    const shared = [...distinctiveWords(it.title, df)].some((w) => mine.has(w));
    if (!shared) continue;
    // Both name a course code and they differ (CS234 vs CS285): different courses, whatever else they share.
    const theirCodes = codesIn(it.title);
    if (myCodes.size && theirCodes.size && ![...myCodes].some((c) => theirCodes.has(c))) continue;
    const sim = dot(q, v);
    const needed = sharesPhrase(pasteText, it.title) ? JOIN_PHRASE_MIN : JOIN_MIN;
    if (sim >= needed && (!best || sim > best.sim)) best = { item: it, sim };
  }
  return best;
}
