import { groupLines, type Group, type LinkInfo } from './ai/group';
import { placeItem, type PlaceFolder } from './ai/place';
import { db } from './db';
import { isLinkLabel, LIMITS, parseLines, takeWithinLimit, uniqueUrls, type ParsedLine } from './lib/parse';
import { fetchPreview, mapLimit } from './lib/preview';
import { domainOf, isGenericTitle, isIconImage, isVideoUrl, normalizeUrl, titleFromUrl } from './lib/url';
import { addItems, ensureTopicPath, mergeIntoItem, updateItem } from './store';
import { getAISettings } from './settings';
import { findByName, flattenTree, indexTree, MAX_DEPTH, nameKey, PATH_SEP, pathOf, resolvePath, splitPathName, typedPath, type TreeIndex } from './lib/tree';
import type { Item, ItemKind, ItemLink, Preview, Topic } from './types';

/** A topic id, or NEW + a folder path (names joined by \) that will be created on Add. */
export type TopicChoice = string;
export const NEW = 'new:';

export const newChoice = (names: string[]) => NEW + names.join('\\');
/** "+ New" choices as folder names: new:Robotics\Papers → ["Robotics", "Papers"]. */
export const newChoiceNames = (choice: string) => choice.slice(NEW.length).split('\\').filter(Boolean);
export const newChoiceLabel = (choice: string) => newChoiceNames(choice).join(PATH_SEP);

export interface Draft {
  key: string;
  url: string | null;
  kind: ItemKind;
  title: string;
  description: string;
  siteName: string;
  author: string;
  image: string | null;
  duration: number | null;
  /** Present when the item has two or more links. */
  links?: ItemLink[];
  choice: TopicChoice;
  /** How the topic was picked: a folder path you wrote, by the AI, from where you filed the same site before, or a duplicate. */
  source: 'path' | 'ai' | 'history' | 'duplicate';
  duplicateOf: string | null;
  include: boolean;
  /** Your own words from the paste (not a page description), used when adding to an existing item. */
  notes: string;
  /** One-item mode: other folders the AI thought could fit. */
  alternatives?: TopicChoice[];
  /** One-item mode: an existing item the AI thinks this continues (the next lecture of a saved course). */
  joinTo?: { id: string; title: string; topicId: string };
  /** Add to joinTo instead of saving a new item. */
  join?: boolean;
  /**
   * Local mode: where "+ New folder" would go (inside `parent`, or a new area when null), whether to
   * offer it first because no folder fits well, and the text the naming model describes.
   */
  newFolder?: { parent: string[] | null; preselect: boolean; text: string; areas: string[] };
}

/** Everything known about one pasted link after its preview. */
export interface LinkData {
  ref: string;
  /** As pasted. */
  original: string;
  /** Where it really goes (short links resolved). */
  url: string;
  normUrl: string | null;
  /** Useful page title, or '' when the preview was generic ("LinkedIn") or failed. */
  title: string;
  description: string;
  siteName: string;
  author: string;
  image: string | null;
  kind: 'link' | 'video';
  duration: number | null;
}

/** Sites that cover every subject, so "you always file this site under X" doesn't apply. */
const GENERIC_DOMAINS = new Set([
  'youtube.com', 'youtu.be', 'vimeo.com', 'medium.com', 'substack.com', 'github.com', 'gist.github.com', 'twitter.com', 'x.com',
  'reddit.com', 'news.ycombinator.com', 'wikipedia.org', 'en.wikipedia.org', 'google.com', 'docs.google.com', 'drive.google.com',
  'linkedin.com', 'lnkd.in', 'facebook.com', 'instagram.com', 'tiktok.com', 'nytimes.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk',
  'arxiv.org', 'dev.to', 'notion.so', 'notion.site', 'amazon.com', 'goodreads.com', 'spotify.com', 'open.spotify.com', 'podcasts.apple.com',
]);

const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Topic that every earlier item from this site went to (at least 3 of them), if any. */
function historyTopic(domain: string, items: Item[], topics: Topic[]): string | null {
  if (!domain || GENERIC_DOMAINS.has(domain) || domain.endsWith('.substack.com') || domain.endsWith('.medium.com')) return null;
  const counts = new Map<string, number>();
  for (const it of items) if (domainOf(it.url) === domain) counts.set(it.topicId, (counts.get(it.topicId) ?? 0) + 1);
  if (counts.size !== 1) return null;
  const [[topicId, n]] = [...counts];
  return n >= 3 && topics.some((t) => t.id === topicId) ? topicId : null;
}

/** A folder path you wrote: the existing folder, or the path to create (existing parts keep their saved names). */
export function choiceForPath(names: string[], tree: TreeIndex): TopicChoice {
  const { topic, missing } = resolvePath(names, tree);
  if (topic && !missing.length) return topic.id;
  return newChoice([...(topic ? pathOf(topic, tree).map((t) => t.name) : []), ...missing]);
}

/** The AI's topic: an existing folder by path or name, or a new one (possibly inside an existing folder). */
export function choiceForName(name: string, topics: Topic[], tree = indexTree(topics)): TopicChoice {
  const found = findByName(name.trim() || 'Inbox', topics, tree);
  if (found) return found.id;
  const parts = splitPathName(name).slice(0, MAX_DEPTH);
  if (parts.length > 1) return choiceForPath(parts.map((p, i) => (i === parts.length - 1 ? titleCase(p) : p)), tree);
  return newChoice([titleCase(parts[0] ?? 'Inbox')]);
}

const INBOX = 'Inbox';
const isInbox = (names: string[]) => names.length === 1 && nameKey(names[0]) === nameKey(INBOX);

/** Folder names a choice stands for: an existing folder's path, or the path to create. */
function choiceNames(choice: TopicChoice, tree: TreeIndex): string[] {
  if (choice.startsWith(NEW)) return newChoiceNames(choice);
  const t = tree.byId.get(choice);
  return t ? pathOf(t, tree).map((x) => x.name) : [];
}

/** Sorting files things at least 2 levels deep (Robotics › Robot Learning). A 1-level answer goes to Inbox for you to choose. */
export function atLeastTwoLevels(choice: TopicChoice, topics: Topic[], tree = indexTree(topics)): TopicChoice {
  const names = choiceNames(choice, tree);
  return names.length >= 2 || isInbox(names) ? choice : choiceForName(INBOX, topics, tree);
}

/**
 * A 1-level folder you wrote (\robotics): the AI's subfolder inside it. When the AI named
 * somewhere else, its last name becomes the subfolder; with no usable answer, the folder itself.
 */
export function choiceInside(folder: string, aiTopic: string, topics: Topic[], tree = indexTree(topics)): TopicChoice {
  const names = choiceNames(choiceForName(aiTopic, topics, tree), tree);
  if (names.length >= 2 && nameKey(names[0]) === nameKey(folder)) return choiceForPath(names, tree);
  const leaf = names[names.length - 1];
  if (leaf && nameKey(leaf) !== nameKey(folder) && !isInbox([leaf])) return choiceForPath([folder, leaf], tree);
  return choiceForPath([folder], tree);
}

/** A folder path that needs no AI: one you wrote with 2 or more levels. */
const fixedFolder = (l: ParsedLine) => ((l.folder ?? l.section)?.length ?? 0) >= 2;

const sectionKey = (l: ParsedLine | undefined) => (l?.section ?? []).map(nameKey).join('\\');

/**
 * A path on a line of its own starts a new section, and an item never spans two sections:
 * a group the AI made across a path line is split there.
 */
export function splitBySection(groups: Group[], lines: ParsedLine[]): Group[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  return groups.flatMap((g) => {
    const parts = new Map<string, number[]>();
    for (const n of g.lines) parts.set(sectionKey(byN.get(n)), [...(parts.get(sectionKey(byN.get(n))) ?? []), n]);
    if (parts.size < 2) return [g];
    return [...parts.values()].map((ls, i) => ({ ...g, lines: ls, title: i === 0 ? g.title : '' }));
  });
}

export function toLinkData(ref: string, original: string, pv: Preview | null): LinkData {
  const url = pv?.resolvedUrl || original;
  const good = !!pv?.title && !isGenericTitle(pv.title, pv.siteName, url);
  return {
    ref,
    original,
    url,
    normUrl: normalizeUrl(url),
    title: good ? pv!.title : '',
    description: good ? pv!.description : '',
    siteName: (good && pv?.siteName) || domainOf(url),
    author: good ? pv?.author ?? '' : '',
    image: good && !isIconImage(pv?.image ?? null) ? pv?.image ?? null : null,
    kind: pv?.kind === 'video' || isVideoUrl(url) ? 'video' : 'link',
    duration: pv?.duration ?? null,
  };
}

/** Links already saved, by their comparable URL, including the extra links of multi-link items. */
export function knownLinks(items: Item[]): Map<string, Item> {
  const m = new Map<string, Item>();
  for (const it of items) {
    if (it.normUrl) m.set(it.normUrl, it);
    for (const l of it.links ?? []) if (l.normUrl) m.set(l.normUrl, it);
  }
  return m;
}

/**
 * Turns groups of lines into review drafts. Pure, so it can be tested.
 * - Lines that only name a link ("Video: …", "Slides: …") become that link's label.
 * - All other lines are kept, word for word, as the item's notes.
 * - With two or more links, every link is listed on the item; the main one is its title link.
 */
export function buildDrafts(
  lines: ParsedLine[],
  groups: Group[],
  links: Map<string, LinkData>,
  topics: Topic[],
  items: Item[],
  /** One item from the whole paste: the first folder written anywhere applies to it. */
  opts: { single?: boolean } = {},
): Draft[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const known = knownLinks(items);
  const tree = indexTree(topics);
  return (opts.single ? groups : splitBySection(groups, lines)).map((g, gi) => {
    const gl = g.lines.map((n) => byN.get(n)).filter((l): l is ParsedLine => !!l);
    // A path you wrote on one of the item's lines, else the section it's in.
    const folder = gl.find((l) => l.folder)?.folder ?? (opts.single ? gl.find((l) => l.section)?.section : gl[0]?.section);
    const labelOf = new Map<string, string>();
    const notes: string[] = [];
    for (const l of gl) {
      if (isLinkLabel(l)) labelOf.set(l.urls[0], l.text);
      else if (l.text) notes.push(`${l.blankBefore && notes.length ? '\n' : ''}${l.text}`);
    }
    const ls = [...new Set(gl.flatMap((l) => l.urls))].map((u) => links.get(u)).filter((x): x is LinkData => !!x);
    const main = ls.find((l) => l.ref === g.mainLink) ?? ls.find((l) => l.kind === 'video' && ls.length > 1) ?? ls[0] ?? null;
    const single = ls.length === 1 ? ls[0] : null;
    const label = single ? labelOf.get(single.original) ?? '' : '';

    let title: string;
    if (single && single.title && !notes.length) title = single.title;
    else title = g.title || single?.title || label || shorten(notes.join(' ').trim(), 80) || (main ? titleFromUrl(main.url) : 'Note');

    // For a single link, a short label you wrote ("intro to LLMs") is worth keeping as a note.
    const noteText = [notes.join('\n').trim(), label && label !== title ? label : ''].filter(Boolean).join('\n');
    const description = noteText || (single ? single.description : '');

    const dups = ls.map((l) => (l.normUrl ? known.get(l.normUrl) : undefined));
    const dup = ls.length > 0 && dups.every(Boolean) ? dups[0]! : undefined;
    const hist = !folder && !dup && single && !notes.length ? historyTopic(domainOf(single.url), items, topics) : null;
    const withImage = main?.image ? main : ls.find((l) => l.image);

    return {
      key: `g${gi}`,
      url: main?.url ?? null,
      kind: main ? main.kind : 'note',
      title,
      description,
      siteName: main?.siteName ?? '',
      author: main?.author ?? '',
      image: withImage?.image ?? null,
      duration: main?.duration ?? null,
      ...(ls.length > 1
        ? {
            links: ls.map((l) => ({
              url: l.url, normUrl: l.normUrl, label: labelOf.get(l.original) ?? '', title: l.title, siteName: l.siteName, image: l.image, kind: l.kind, duration: l.duration,
            })),
          }
        : {}),
      // A path you wrote wins. A duplicate still starts unchecked, so it isn't saved twice by accident.
      choice: folder
        ? folder.length >= 2
          ? choiceForPath(folder, tree)
          : choiceInside(folder[0], g.topic, topics, tree)
        : dup
          ? dup.topicId
          : hist ?? atLeastTwoLevels(choiceForName(g.topic, topics, tree), topics, tree),
      source: folder ? 'path' : dup ? 'duplicate' : hist ? 'history' : 'ai',
      duplicateOf: dup ? topics.find((t) => t.id === dup.topicId)?.name ?? 'another topic' : null,
      include: !dup,
      notes: noteText,
    };
  });
}

export interface Prepared {
  drafts: Draft[];
  /** Text beyond the size limits, left in the box for a second round. */
  leftover: string;
  aiCount: number;
  model: string;
}

/** Previews for each link, with L1, L2… refs. */
async function fetchLinks(urls: string[], onStatus: (s: string) => void) {
  if (urls.length) onStatus(`Fetching previews 0/${urls.length}…`);
  let fetched = 0;
  const previews = await mapLimit(urls, 4, async (u) => {
    const r = await fetchPreview(u);
    onStatus(`Fetching previews ${++fetched}/${urls.length}…`);
    return r;
  });
  const refOf = new Map(urls.map((u, i) => [u, `L${i + 1}`]));
  const links = new Map(urls.map((u, i) => [u, toLinkData(`L${i + 1}`, u, previews[i])]));
  const info: LinkInfo[] = urls.map((u) => {
    const d = links.get(u)!;
    return { ref: d.ref, url: d.url, site: d.siteName, title: d.title, description: d.description };
  });
  return { refOf, links, info };
}

/** How many of the latest items per folder the AI sees, and how many folders at most. */
export const RECENT_PER_FOLDER = 5;
const MAX_FOLDERS_SENT = 80;

/** Folders in priority order, each with its latest items as i1, i2… refs. */
export function foldersForAI(topics: Topic[], items: Item[], tree = indexTree(topics)): { folders: PlaceFolder[]; itemOf: Map<string, Item> } {
  const byTopic = new Map<string, Item[]>();
  for (const it of [...items].sort((a, b) => b.addedAt - a.addedAt)) {
    const list = byTopic.get(it.topicId) ?? [];
    if (list.length < RECENT_PER_FOLDER) byTopic.set(it.topicId, [...list, it]);
  }
  const itemOf = new Map<string, Item>();
  const folders = flattenTree(topics, tree)
    .slice(0, MAX_FOLDERS_SENT)
    .map((f) => ({
      path: f.path.join(PATH_SEP),
      recent: (byTopic.get(f.topic.id) ?? []).map((it) => {
        const ref = `i${itemOf.size + 1}`;
        itemOf.set(ref, it);
        return { ref, title: it.title };
      }),
    }));
  return { folders, itemOf };
}

/** Too much for one item: the box says to tick "Several things". */
export class TooLongForOne extends Error {}

/**
 * The default mode: the whole paste is ONE item, and the only question is where it goes.
 * A folder path with 2 or more levels settles that without the AI.
 */
export async function prepareOne(input: string, onStatus: (s: string) => void): Promise<Prepared> {
  const lines = parseLines(input);
  const urls = uniqueUrls(lines);
  if (!lines.length) return { drafts: [], leftover: '', aiCount: 0, model: '' };
  if (input.length > LIMITS.maxChars || urls.length > LIMITS.maxLinks || lines.length > LIMITS.maxLines) {
    throw new TooLongForOne(`That's more than one item can hold (${LIMITS.maxLinks} links or ${LIMITS.maxLines} lines). Tick “Several things” to split it.`);
  }
  const [topics, items] = await Promise.all([db.topics.toArray(), db.items.toArray()]);
  const tree = indexTree(topics);
  const { refOf, links, info } = await fetchLinks(urls, onStatus);
  const all = lines.map((l) => l.n);
  const folder = lines.find((l) => l.folder)?.folder ?? lines.find((l) => l.section)?.section;
  const first = lines[0];
  const heading = lines.length > 1 && !first.urls.length && first.text.length <= 80 && !/[.?!:]$/.test(first.text) ? first.text : '';

  if (folder && folder.length >= 2) {
    const drafts = buildDrafts(lines, [{ lines: all, title: heading, mainLink: null, topic: '', isNew: false }], links, topics, items, { single: true });
    return { drafts, leftover: '', aiCount: 0, model: '' };
  }

  if ((await getAISettings()).engine === 'local') return placeOneLocally(lines, links, topics, items, folder?.[0] ?? null, heading, onStatus);

  onStatus('Finding the right folder…');
  const { folders, itemOf } = foldersForAI(topics, items, tree);
  const { placement: p, model } = await placeItem(folders, lines, info, refOf);
  const [d] = buildDrafts(lines, [{ lines: all, title: p.title || heading, mainLink: p.mainLink, topic: p.topic, isNew: false }], links, topics, items, { single: true });

  // Other folders, held to the same rules as the main pick.
  const place = (name: string) => (folder ? choiceInside(folder[0], name, topics, tree) : atLeastTwoLevels(choiceForName(name, topics, tree), topics, tree));
  const inbox = choiceForName(INBOX, topics, tree);
  d.alternatives = [...new Set(p.alternatives.map(place))].filter((c) => c !== d.choice && c !== inbox);

  // Adding to an existing item: only one the AI was shown, and inside the folder you wrote, if any.
  const target = p.joinItem ? itemOf.get(p.joinItem) : undefined;
  const targetPath = target && tree.byId.get(target.topicId) ? pathOf(tree.byId.get(target.topicId)!, tree).map((t) => nameKey(t.name)) : [];
  const fitsFolder = !folder || folder.every((n, i) => targetPath[i] === nameKey(n));
  if (target && d.source !== 'duplicate' && fitsFolder) {
    d.joinTo = { id: target.id, title: target.title, topicId: target.topicId };
    d.join = true;
  }
  return { drafts: [d], leftover: '', aiCount: lines.length, model };
}

/** Local mode: the same one-item draft, placed by the embedding model in this browser. */
async function placeOneLocally(
  lines: ParsedLine[],
  links: Map<string, LinkData>,
  topics: Topic[],
  items: Item[],
  typed: string | null,
  heading: string,
  onStatus: (s: string) => void,
): Promise<Prepared> {
  const [d] = buildDrafts(lines, [{ lines: lines.map((l) => l.n), title: heading, mainLink: null, topic: INBOX, isNew: false }], links, topics, items, { single: true });
  const { placeLocal } = await import('./local/place');
  onStatus('Preparing your saved items…');
  const p = await placeLocal(d.title, d.notes || d.description, topics, items, typed, onStatus);
  // A duplicate stays where it is, and "you always file this site there" still wins.
  if (p.best && (d.source === 'ai' || d.source === 'path')) d.choice = p.best;
  d.alternatives = p.alternatives.filter((c) => c !== d.choice);
  if (p.joinTo && d.source !== 'duplicate') {
    d.joinTo = { id: p.joinTo.id, title: p.joinTo.title, topicId: p.joinTo.topicId };
    d.join = true;
  }
  d.newFolder = { parent: p.newParent, preselect: p.weak && !d.join && (d.source === 'ai' || d.source === 'path'), text: p.text, areas: p.areas };
  return { drafts: [d], leftover: '', aiCount: 1, model: 'the local model' };
}

export async function prepareDrafts(input: string, onStatus: (s: string) => void): Promise<Prepared> {
  const [now, later] = takeWithinLimit(input);
  const all = parseLines(now);
  // Keep within the link and line caps; whole lines that don't fit stay in the box.
  let lines = all;
  let count = 0;
  const seen = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    for (const u of all[i].urls) if (!seen.has(u)) (seen.add(u), count++);
    if (count > LIMITS.maxLinks || i >= LIMITS.maxLines) {
      lines = all.slice(0, i);
      break;
    }
  }
  // What's left keeps its folder: the section it was in is written again at the top.
  const rest = all.slice(lines.length);
  const carry = (rest[0] ?? all[all.length - 1])?.section;
  const leftoverBody = [rest.map((l) => l.source).join('\n'), later].filter(Boolean).join('\n');
  const leftover = leftoverBody && carry ? `${typedPath(carry)}\n${leftoverBody}` : leftoverBody;

  const [topics, items] = await Promise.all([db.topics.toArray(), db.items.toArray()]);
  const urls = uniqueUrls(lines);
  const { refOf, links, info } = await fetchLinks(urls, onStatus);

  // No AI is needed for a single line with a full folder path, or a plain list of links that each
  // have one, are already saved, or come from a site you always file in one place. A 1-level
  // path (\robotics) still asks the AI, which picks the subfolder inside it.
  const known = knownLinks(items);
  const plainList = lines.length > 0 && lines.every((l) => l.urls.length === 1 && !l.text);
  const allSettled =
    (lines.length === 1 && fixedFolder(lines[0])) ||
    (plainList && lines.every((l) => {
      const d = links.get(l.urls[0])!;
      return fixedFolder(l) || (d.normUrl && known.has(d.normUrl)) || !!historyTopic(domainOf(d.url), items, topics);
    }));

  let groups: Group[];
  let model = '';
  if (allSettled) {
    groups = lines.map((l) => ({ lines: [l.n], title: '', mainLink: refOf.get(l.urls[0]) ?? null, topic: '', isNew: false }));
  } else {
    onStatus(`Sorting ${lines.length} line${lines.length === 1 ? '' : 's'} into items…`);
    const res = await groupLines(flattenTree(topics).map((f) => f.path.join(PATH_SEP)), lines, info, refOf);
    groups = res.groups;
    model = res.model;
  }
  return { drafts: buildDrafts(lines, groups, links, topics, items), leftover, aiCount: allSettled ? 0 : lines.length, model };
}

export async function acceptDrafts(drafts: Draft[]): Promise<number> {
  const joins = drafts.filter((d) => d.include && d.join && d.joinTo);
  for (const d of joins) await mergeIntoItem(d.joinTo!.id, { ...d, links: d.links });
  const chosen = drafts.filter((d) => d.include && d.choice && !(d.join && d.joinTo));
  const topicIds = new Map<string, string>();
  for (const d of chosen) {
    if (d.choice.startsWith(NEW) && !topicIds.has(d.choice)) topicIds.set(d.choice, await ensureTopicPath(newChoiceNames(d.choice)));
  }
  const n = await addItems(
    chosen.map((d) => ({
      topicId: topicIds.get(d.choice) ?? d.choice,
      kind: d.kind,
      url: d.url,
      title: d.title,
      description: d.description,
      siteName: d.siteName,
      author: d.author,
      image: d.image,
      duration: d.duration,
      links: d.links,
    })),
  );
  // Open each folder that got something, and the folders around it, so you can see where it went.
  const touched = new Set([...chosen.map((d) => topicIds.get(d.choice) ?? d.choice), ...joins.map((d) => d.joinTo!.topicId)]);
  const tree = indexTree(await db.topics.toArray());
  const toOpen = new Set([...touched].flatMap((id) => (tree.byId.get(id) ? pathOf(tree.byId.get(id)!, tree).map((t) => t.id) : [])));
  await Promise.all([...toOpen].map((id) => db.topics.update(id, { open: true })));
  return n + joins.length;
}

const LINKEDIN_EXIT = /take you to a page that.{1,3}s not on LinkedIn/i;

/**
 * Fetch previews again for saved links (for example items that only say "LinkedIn").
 * Only fills in what the new preview actually knows; your own titles and notes are kept.
 */
export async function refreshPreviews(list: Item[], onEach?: (done: number) => void): Promise<number> {
  const withLinks = list.filter((i) => i.url || i.links?.length);
  let improved = 0;
  await mapLimit(
    withLinks,
    3,
    async (it) => {
      const patch: Partial<Item> = {};
      if (it.links?.length) {
        const fresh = await Promise.all(it.links.map(async (l) => toLinkData('', l.url, await fetchPreview(l.url))));
        patch.links = it.links.map((l, i) => ({
          ...l,
          url: fresh[i].url,
          normUrl: fresh[i].normUrl,
          title: fresh[i].title || l.title,
          siteName: fresh[i].siteName,
          image: fresh[i].image ?? l.image,
          kind: fresh[i].kind,
          duration: fresh[i].duration ?? l.duration,
        }));
        const main = patch.links.find((l) => l.url === it.url || normalizeUrl(l.url) === it.normUrl) ?? patch.links[0];
        Object.assign(patch, { url: main.url, normUrl: main.normUrl, siteName: main.siteName, image: it.image ?? patch.links.find((l) => l.image)?.image ?? null });
      } else if (it.url) {
        const d = toLinkData('', it.url, await fetchPreview(it.url));
        const oldWeak = isGenericTitle(it.title, it.siteName, it.url) || LINKEDIN_EXIT.test(it.description);
        if (!d.title && d.url === it.url) return;
        Object.assign(patch, { url: d.url, normUrl: d.normUrl, siteName: d.siteName });
        if (d.title) {
          if (oldWeak || !it.title) patch.title = d.title;
          if (oldWeak || !it.description) patch.description = d.description;
          if (d.author) patch.author = d.author;
          if (d.image) patch.image = d.image;
          if (d.duration) patch.duration = d.duration;
          if (d.kind === 'video') patch.kind = 'video';
        } else if (oldWeak) {
          Object.assign(patch, { title: titleFromUrl(d.url), description: '', image: null });
        }
      }
      if (!Object.keys(patch).length) return;
      await updateItem(it.id, patch);
      improved++;
    },
    onEach,
  );
  return improved;
}
