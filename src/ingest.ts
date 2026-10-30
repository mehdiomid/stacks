import { groupLines, type Group, type LinkInfo } from './ai/group';
import { db } from './db';
import { isLinkLabel, LIMITS, parseLines, takeWithinLimit, uniqueUrls, type ParsedLine } from './lib/parse';
import { fetchPreview, mapLimit } from './lib/preview';
import { domainOf, isGenericTitle, isIconImage, isVideoUrl, normalizeUrl, titleFromUrl } from './lib/url';
import { addItems, ensureTopicPath, updateItem } from './store';
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
export function buildDrafts(lines: ParsedLine[], groups: Group[], links: Map<string, LinkData>, topics: Topic[], items: Item[]): Draft[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const known = knownLinks(items);
  const tree = indexTree(topics);
  return splitBySection(groups, lines).map((g, gi) => {
    const gl = g.lines.map((n) => byN.get(n)).filter((l): l is ParsedLine => !!l);
    // A path you wrote on one of the item's lines, else the section it's in.
    const folder = gl.find((l) => l.folder)?.folder ?? gl[0]?.section;
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
      choice: folder ? choiceForPath(folder, tree) : dup ? dup.topicId : hist ?? choiceForName(g.topic, topics, tree),
      source: folder ? 'path' : dup ? 'duplicate' : hist ? 'history' : 'ai',
      duplicateOf: dup ? topics.find((t) => t.id === dup.topicId)?.name ?? 'another topic' : null,
      include: !dup,
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
  if (urls.length) onStatus(`Fetching previews 0/${urls.length}…`);
  let fetched = 0;
  const previews = await mapLimit(urls, 4, async (u) => {
    const r = await fetchPreview(u);
    onStatus(`Fetching previews ${++fetched}/${urls.length}…`);
    return r;
  });
  const refOf = new Map(urls.map((u, i) => [u, `L${i + 1}`]));
  const links = new Map(urls.map((u, i) => [u, toLinkData(`L${i + 1}`, u, previews[i])]));

  // No AI is needed for a single line with a folder path, or a plain list of links that each
  // have a folder path, are already saved, or come from a site you always file in one place.
  const known = knownLinks(items);
  const plainList = lines.length > 0 && lines.every((l) => l.urls.length === 1 && !l.text);
  const allSettled =
    (lines.length === 1 && !!(lines[0].folder ?? lines[0].section)) ||
    (plainList && lines.every((l) => {
      const d = links.get(l.urls[0])!;
      return !!(l.folder ?? l.section) || (d.normUrl && known.has(d.normUrl)) || !!historyTopic(domainOf(d.url), items, topics);
    }));

  let groups: Group[];
  let model = '';
  if (allSettled) {
    groups = lines.map((l) => ({ lines: [l.n], title: '', mainLink: refOf.get(l.urls[0]) ?? null, topic: '', isNew: false }));
  } else {
    onStatus(`Sorting ${lines.length} line${lines.length === 1 ? '' : 's'} into items…`);
    const info: LinkInfo[] = urls.map((u) => {
      const d = links.get(u)!;
      return { ref: d.ref, url: d.url, site: d.siteName, title: d.title, description: d.description };
    });
    const res = await groupLines(flattenTree(topics).map((f) => f.path.join(PATH_SEP)), lines, info, refOf);
    groups = res.groups;
    model = res.model;
  }
  return { drafts: buildDrafts(lines, groups, links, topics, items), leftover, aiCount: allSettled ? 0 : lines.length, model };
}

export async function acceptDrafts(drafts: Draft[]): Promise<number> {
  const chosen = drafts.filter((d) => d.include && d.choice);
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
  const touched = new Set(chosen.map((d) => topicIds.get(d.choice) ?? d.choice));
  const tree = indexTree(await db.topics.toArray());
  const toOpen = new Set([...touched].flatMap((id) => (tree.byId.get(id) ? pathOf(tree.byId.get(id)!, tree).map((t) => t.id) : [])));
  await Promise.all([...toOpen].map((id) => db.topics.update(id, { open: true })));
  return n;
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
