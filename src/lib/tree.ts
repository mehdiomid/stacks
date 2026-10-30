import type { Topic } from '../types';

/** Folders nest at most this deep: \robotics\papers\grasping. */
export const MAX_DEPTH = 3;

/** How folder names are compared: case, spaces, hyphens and underscores don't matter ("open-models" = "Open Models"). */
export const nameKey = (s: string) => s.toLowerCase().replace(/[\s_\-–—]+/g, '');

/**
 * A folder name from what was typed. Unquoted: hyphens and underscores become spaces, and an all-lowercase
 * name gets capitals (machine-learning → Machine Learning). Quoted names are kept as written ("GPT-5 notes").
 */
export function displayName(typed: string, quoted = false): string {
  const s = (quoted ? typed : typed.replace(/[_-]+/g, ' ')).replace(/\s+/g, ' ').trim();
  return !quoted && s === s.toLowerCase() ? s.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase()) : s;
}

export interface TreeIndex {
  byId: Map<string, Topic>;
  /** Parent id, or null for top level. A missing parent or a loop counts as top level. */
  parentOf: (t: Topic) => string | null;
  /** Children in their saved order. Use null for top level. */
  children: (parentId: string | null) => Topic[];
}

export function indexTree(topics: Topic[]): TreeIndex {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const parentCache = new Map<string, string | null>();
  const parentOf = (t: Topic): string | null => {
    if (parentCache.has(t.id)) return parentCache.get(t.id)!;
    let p: string | null = t.parentId && byId.has(t.parentId) ? t.parentId : null;
    // Guard against a loop (only possible from a damaged import).
    const seen = new Set([t.id]);
    for (let cur = p; cur; cur = byId.get(cur)?.parentId ?? null) {
      if (seen.has(cur)) {
        p = null;
        break;
      }
      seen.add(cur);
    }
    parentCache.set(t.id, p);
    return p;
  };
  const kids = new Map<string | null, Topic[]>();
  for (const t of topics) {
    const p = parentOf(t);
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  return { byId, parentOf, children: (id) => kids.get(id) ?? [] };
}

export interface FlatTopic {
  topic: Topic;
  depth: number;
  /** Names from the top level down, this topic included. */
  path: string[];
  /** Priority as shown on the card: "2", or "2.1" for the first folder inside the second. */
  rank: string;
}

/** Every topic in reading order: a folder, then its subfolders, then the next folder. This is also priority order. */
export function flattenTree(topics: Topic[], tree = indexTree(topics)): FlatTopic[] {
  const out: FlatTopic[] = [];
  const walk = (parentId: string | null, depth: number, path: string[], rank: string) => {
    tree.children(parentId).forEach((t, i) => {
      const p = [...path, t.name];
      out.push({ topic: t, depth, path: p, rank: `${rank}${i + 1}` });
      walk(t.id, depth + 1, p, `${rank}${i + 1}.`);
    });
  };
  walk(null, 1, [], '');
  return out;
}

export const PATH_SEP = ' › ';

export function pathOf(topic: Topic, tree: TreeIndex): Topic[] {
  const out: Topic[] = [topic];
  for (let p = tree.parentOf(topic); p; p = tree.parentOf(tree.byId.get(p)!)) out.unshift(tree.byId.get(p)!);
  return out;
}

export const pathLabel = (topic: Topic, tree: TreeIndex) => pathOf(topic, tree).map((t) => t.name).join(PATH_SEP);

/** All folders inside this one, at any depth. */
export function descendantIds(id: string, tree: TreeIndex): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const c of tree.children(pid)) {
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** 1 for a folder with no subfolders, 2 with subfolders, 3 with sub-subfolders. */
export function heightOf(id: string, tree: TreeIndex): number {
  return 1 + Math.max(0, ...tree.children(id).map((c) => heightOf(c.id, tree)));
}

/** Can `id` (with everything inside it) go into `parentId` without passing the depth limit? */
export function canNest(id: string, parentId: string | null, tree: TreeIndex): boolean {
  if (!parentId) return true;
  const parent = tree.byId.get(parentId);
  if (!parent || parentId === id || descendantIds(id, tree).includes(parentId)) return false;
  return pathOf(parent, tree).length + heightOf(id, tree) <= MAX_DEPTH;
}

/** Finds the child of `parentId` with this name (compared by nameKey). */
export const childNamed = (parentId: string | null, name: string, tree: TreeIndex) =>
  tree.children(parentId).find((t) => nameKey(t.name) === nameKey(name));

/**
 * Walks a path of names from the top. Returns the deepest existing folder and the names still missing.
 * ["Robotics", "Papers"] with only Robotics saved → { topic: Robotics, missing: ["Papers"] }.
 */
export function resolvePath(names: string[], tree: TreeIndex): { topic: Topic | null; missing: string[] } {
  let topic: Topic | null = null;
  for (let i = 0; i < names.length; i++) {
    const next = childNamed(topic?.id ?? null, names[i], tree);
    if (!next) return { topic, missing: names.slice(i) };
    topic = next;
  }
  return { topic, missing: [] };
}

/**
 * A folder by a name the AI (or an instruction) gave: a full path ("Robotics › Papers", "Robotics/Papers",
 * "\robotics\papers") or a single name, which matches a top-level folder first, then the shallowest subfolder.
 */
export function findByName(name: string, topics: Topic[], tree = indexTree(topics)): Topic | null {
  const parts = splitPathName(name);
  if (!parts.length) return null;
  if (parts.length > 1) {
    const r = resolvePath(parts, tree);
    return r.missing.length ? null : r.topic;
  }
  const flat = flattenTree(topics, tree);
  return flat.filter((f) => nameKey(f.topic.name) === nameKey(parts[0])).sort((a, b) => a.depth - b.depth)[0]?.topic ?? null;
}

/** "Robotics › Papers", "Robotics > Papers" or "\robotics\papers" → ["Robotics", "Papers"] (as written). "AI/ML" stays one name. */
export function splitPathName(name: string): string[] {
  return name
    .split(/\s*(?:›|>|\\)\s*/)
    .map((s) => s.trim().replace(/^["“”]|["“”]$/g, '').trim())
    .filter(Boolean);
}

/** A folder path as you'd type it: \robotics\papers, with quotes for names that need them. */
export function typedPath(names: string[]): string {
  return names
    .map((n) => {
      const simple = n.replace(/ /g, '-');
      return /^[\p{L}\p{N}&+.']+$/u.test(n.replace(/ /g, '')) ? `\\${simple}` : `\\"${n}"`;
    })
    .join('');
}
