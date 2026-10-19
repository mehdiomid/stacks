import { classify, type ClassifyInput } from './ai/classify';
import { db } from './db';
import { LIMITS, splitPieces, takeWithinLimit } from './lib/parse';
import { fetchPreview, mapLimit } from './lib/preview';
import { domainOf, isVideoUrl, normalizeUrl, titleFromUrl } from './lib/url';
import { addItems, createTopic } from './store';
import type { Item, ItemKind, Topic } from './types';

/** A topic id, or NEW + a name for a topic that will be created. */
export type TopicChoice = string;
export const NEW = 'new:';

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
  text: string;
  choice: TopicChoice;
  /** How the topic was picked: by the AI, from where you filed the same site before, or a duplicate. */
  source: 'ai' | 'history' | 'duplicate';
  duplicateOf: string | null;
  include: boolean;
}

/** Sites that cover every subject, so "you always file this site under X" doesn't apply. */
const GENERIC_DOMAINS = new Set([
  'youtube.com', 'youtu.be', 'vimeo.com', 'medium.com', 'substack.com', 'github.com', 'gist.github.com', 'twitter.com', 'x.com',
  'reddit.com', 'news.ycombinator.com', 'wikipedia.org', 'en.wikipedia.org', 'google.com', 'docs.google.com', 'drive.google.com',
  'linkedin.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'nytimes.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk',
  'arxiv.org', 'dev.to', 'notion.so', 'notion.site', 'amazon.com', 'goodreads.com', 'spotify.com', 'open.spotify.com', 'podcasts.apple.com',
]);

const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Topic that every earlier item from this site went to (at least 3 of them), if any. */
function historyTopic(domain: string, items: Item[], topics: Topic[]): string | null {
  if (!domain || GENERIC_DOMAINS.has(domain) || domain.endsWith('.substack.com') || domain.endsWith('.medium.com')) return null;
  const counts = new Map<string, number>();
  for (const it of items) if (domainOf(it.url) === domain) counts.set(it.topicId, (counts.get(it.topicId) ?? 0) + 1);
  if (counts.size !== 1) return null;
  const [[topicId, n]] = [...counts];
  return n >= 3 && topics.some((t) => t.id === topicId) ? topicId : null;
}

function choiceForName(name: string, topics: Topic[]): TopicChoice {
  const clean = name.trim() || 'Inbox';
  const t = topics.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  return t ? t.id : NEW + titleCase(clean);
}

export interface Prepared {
  drafts: Draft[];
  /** Text beyond the size limit, left in the box for a second round. */
  leftover: string;
  aiCount: number;
  model: string;
}

export async function prepareDrafts(input: string, onStatus: (s: string) => void): Promise<Prepared> {
  const [now, later] = takeWithinLimit(input);
  let pieces = splitPieces(now);
  let leftover = later;
  if (pieces.length > LIMITS.maxPieces) {
    const extra = pieces.slice(LIMITS.maxPieces).map((p) => [p.url, p.text].filter(Boolean).join(' ')).join('\n');
    leftover = [extra, leftover].filter(Boolean).join('\n');
    pieces = pieces.slice(0, LIMITS.maxPieces);
  }
  const [topics, items] = await Promise.all([db.topics.orderBy('order').toArray(), db.items.toArray()]);
  const known = new Map(items.filter((i) => i.normUrl).map((i) => [i.normUrl!, i]));

  const withUrl = pieces.filter((p) => p.url).length;
  if (withUrl) onStatus(`Fetching previews 0/${withUrl}…`);
  let fetched = 0;
  const previews = await mapLimit(pieces, 4, async (p) => {
    if (!p.url) return null;
    const r = await fetchPreview(p.url);
    onStatus(`Fetching previews ${++fetched}/${withUrl}…`);
    return r;
  });

  const drafts: Draft[] = pieces.map((p, i) => {
    const pv = previews[i];
    const key = `d${i}`;
    if (!p.url) {
      const firstLine = p.text.split('\n')[0];
      return {
        key, url: null, kind: 'note', title: firstLine.length > 90 ? `${firstLine.slice(0, 88)}…` : firstLine,
        description: p.text.length > firstLine.length ? p.text : '', siteName: '', author: '', image: null, duration: null,
        text: p.text, choice: '', source: 'ai', duplicateOf: null, include: true,
      };
    }
    const norm = normalizeUrl(p.url);
    const dup = norm ? known.get(norm) : undefined;
    const domain = domainOf(p.url);
    const hist = dup ? null : historyTopic(domain, items, topics);
    return {
      key,
      url: p.url,
      kind: pv?.kind === 'video' || isVideoUrl(p.url) ? 'video' : 'link',
      title: pv?.title || p.text || titleFromUrl(p.url),
      description: pv?.description || (pv?.title && p.text ? p.text : ''),
      siteName: pv?.siteName || domain,
      author: pv?.author ?? '',
      image: pv?.image ?? null,
      duration: pv?.duration ?? null,
      text: p.text,
      choice: dup ? dup.topicId : hist ?? '',
      source: dup ? 'duplicate' : hist ? 'history' : 'ai',
      duplicateOf: dup ? topics.find((t) => t.id === dup.topicId)?.name ?? 'another topic' : null,
      include: !dup,
    };
  });

  const needAI = drafts.map((d, index) => ({ d, index })).filter(({ d }) => d.source === 'ai');
  let model = '';
  if (needAI.length) {
    onStatus(`Sorting ${needAI.length} item${needAI.length === 1 ? '' : 's'}…`);
    const inputs: ClassifyInput[] = needAI.map(({ d, index }) => ({
      index,
      url: d.url,
      site: d.siteName,
      title: d.kind === 'note' ? '' : d.title,
      description: d.description,
      text: d.text,
    }));
    const res = await classify(topics.map((t) => t.name), inputs);
    model = res.model;
    for (const { d, index } of needAI) {
      const r = res.results.get(index);
      d.choice = choiceForName(r?.topic ?? 'Inbox', topics);
      if (r?.title && (d.kind === 'note' || !previews[index]?.title)) d.title = r.title;
    }
  }
  return { drafts, leftover, aiCount: needAI.length, model };
}

export async function acceptDrafts(drafts: Draft[]): Promise<number> {
  const chosen = drafts.filter((d) => d.include && d.choice);
  const topicIds = new Map<string, string>();
  for (const d of chosen) {
    if (d.choice.startsWith(NEW) && !topicIds.has(d.choice)) topicIds.set(d.choice, await createTopic(d.choice.slice(NEW.length)));
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
    })),
  );
  const touched = new Set(chosen.map((d) => topicIds.get(d.choice) ?? d.choice));
  await Promise.all([...touched].map((id) => db.topics.update(id, { open: true })));
  return n;
}
