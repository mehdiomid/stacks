import { indexTree, nameKey, pathOf } from '../lib/tree';
import type { Item, Topic } from '../types';
import { embed } from './embedder';
import { candidateFolders, itemText, joinCandidate, latestIn, LATEST_PER_FOLDER, pathText, rankFolders, titleFrequency, WEAK_MATCH, type Vec } from './score';
import { pathVectors, syncVectors, vectorsById } from './vectors';

export interface LocalPlacement {
  /** Best existing folder, if there is one. */
  best: string | null;
  /** The next two, as quick picks. */
  alternatives: string[];
  /** A saved item this paste continues (similar AND sharing a distinctive name). */
  joinTo: Item | null;
  /** Where a new folder would go: inside this folder (["Robotics"]), or a new area when null. */
  newParent: string[] | null;
  /** No folder fits well: offer "+ New folder" first. */
  weak: boolean;
  /** What the naming model should describe. */
  text: string;
  /** Your top-level areas, most related to this paste first (the naming model leans on the first). */
  areas: string[];
}

/**
 * Places one paste with the local embedding model. `typed` is a 1-level folder you wrote
 * (\robotics): the pick is then a subfolder of it, or a new one inside it.
 */
export async function placeLocal(title: string, notes: string, topics: Topic[], items: Item[], typed: string | null, onStatus: (s: string) => void): Promise<LocalPlacement> {
  const tree = indexTree(topics);
  const text = itemText(title, notes);
  await syncVectors();
  onStatus('Finding the right folder…');

  const top = typed ? tree.children(null).find((t) => nameKey(t.name) === nameKey(typed)) ?? null : null;
  const folders = typed && !top ? [] : candidateFolders(topics, items, top?.id ?? null, tree);
  const names = (t: Topic) => pathOf(t, tree).map((x) => x.name);
  const [vecs, paths, [q]] = await Promise.all([vectorsById(), pathVectors(folders.map((t) => pathText(names(t)))), embed([text])]);
  const folderVecs = (t: Topic): Vec[] => [paths.get(pathText(names(t)))!, ...latestIn(t.id, items).map((i) => vecs.get(i.id)).filter((v): v is Vec => !!v)];
  const ranked = rankFolders(q, folders, folderVecs);
  const best = ranked[0] ?? null;

  // Only items the app would also have shown an AI: the latest few in each folder (inside \typed, if any).
  const inScope = new Set((top ? [top, ...topics.filter((t) => pathOf(t, tree)[0]?.id === top.id)] : topics).map((t) => t.id));
  const shown = [...inScope].flatMap((id) => latestIn(id, items, LATEST_PER_FOLDER));
  const join = joinCandidate(q, `${title} ${notes}`, shown, (id) => vecs.get(id), titleFrequency(items.map((i) => i.title)));

  const weak = !best || best.score < WEAK_MATCH;
  // Areas in order of their best folder's score, then any others.
  const tops = tree.children(null).filter((t) => t.name.trim().toLowerCase() !== 'inbox').map((t) => t.name);
  const areas = [...new Set([...ranked.map((r) => names(r.topic)[0]), ...tops])].filter((a) => tops.includes(a));
  return {
    best: best?.topic.id ?? null,
    alternatives: ranked.slice(1, 3).map((r) => r.topic.id),
    joinTo: join?.item ?? null,
    // When nothing fits well, the closest area is usually wrong too (a hike is not Robotics), so a
    // weak match proposes a whole new "Area › Subject". A decent match puts it inside the closest area.
    newParent: typed ? [top?.name ?? typed] : best && !weak ? [names(best.topic)[0]] : null,
    weak,
    text,
    areas,
  };
}
