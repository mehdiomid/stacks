import { describe, expect, it } from 'vitest';
import { normalizeGroups } from './ai/group';
import { buildDrafts, toLinkData, type LinkData } from './ingest';
import { parseLines, uniqueUrls } from './lib/parse';
import type { Item, Preview, Topic } from './types';

const POST = `My first open model lecture, covering all the many pieces that build the ecosystem, and the open questions/debates determining where it goes next.

How does distillation fit in?
How do we manage risks?
How do we see access to models changing in the future?

I'm excited to revisit these questions about every 6 months, to give a state of the union on the field.

Video: https://lnkd.in/eTjszwXh
Slides: https://lnkd.in/ejEKx9Cu
Reading list: https://lnkd.in/gfyZ7pKf`;

const pv = (resolvedUrl: string, title: string, kind: 'link' | 'video' = 'link'): Preview => ({
  url: '', resolvedUrl, title, description: '', siteName: new URL(resolvedUrl).hostname, author: '', image: null, duration: null, kind,
});

function linksFor(text: string, previews: Record<string, Preview | null>): Map<string, LinkData> {
  return new Map(uniqueUrls(parseLines(text)).map((u, i) => [u, toLinkData(`L${i + 1}`, u, previews[u] ?? null)]));
}

describe('buildDrafts', () => {
  it('keeps a post with its video, slides and reading list as ONE item', () => {
    const lines = parseLines(POST);
    const links = linksFor(POST, {
      'https://lnkd.in/eTjszwXh': pv('https://www.youtube.com/watch?v=abc', 'Open models lecture', 'video'),
      'https://lnkd.in/ejEKx9Cu': null,
      'https://lnkd.in/gfyZ7pKf': pv('https://www.interconnects.ai/p/open-source-ai-reading-list', 'Open-Source AI & Open Models Reading List'),
    });
    const groups = normalizeGroups([{ lines: lines.map((l) => l.n), title: 'Open models lecture: state of the ecosystem', mainLink: 'L1', topic: 'Open Models', isNew: true }], lines.map((l) => l.n));
    const drafts = buildDrafts(lines, groups, links, [], []);

    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.title).toBe('Open models lecture: state of the ecosystem');
    expect(d.url).toBe('https://www.youtube.com/watch?v=abc');
    expect(d.kind).toBe('video');
    expect(d.choice).toBe('new:Open Models');
    expect(d.links?.map((l) => l.label)).toEqual(['Video', 'Slides', 'Reading list']);
    expect(d.links?.[2].title).toBe('Open-Source AI & Open Models Reading List');
    expect(d.links?.[1].url).toBe('https://lnkd.in/ejEKx9Cu');
    // Your words are kept as notes, with paragraph breaks; the label lines are not repeated.
    expect(d.description).toContain('My first open model lecture');
    expect(d.description).toContain('\nHow does distillation fit in?\nHow do we manage risks?');
    expect(d.description).not.toContain('Slides');
  });

  it('keeps a list of unrelated links as separate items titled by their pages', () => {
    const text = 'https://a.com/x\nhttps://b.com/y';
    const lines = parseLines(text);
    const links = linksFor(text, { 'https://a.com/x': pv('https://a.com/x', 'Page A'), 'https://b.com/y': pv('https://b.com/y', 'Page B') });
    const groups = normalizeGroups(
      [
        { lines: [1], title: 'A', mainLink: 'L1', topic: 'Inbox', isNew: false },
        { lines: [2], title: 'B', mainLink: 'L2', topic: 'Inbox', isNew: false },
      ],
      [1, 2],
    );
    const drafts = buildDrafts(lines, groups, links, [], []);
    expect(drafts.map((d) => [d.title, d.url, d.links])).toEqual([
      ['Page A', 'https://a.com/x', undefined],
      ['Page B', 'https://b.com/y', undefined],
    ]);
  });

  it('marks an item as a duplicate only when all its links are already saved', () => {
    const text = 'Talk: https://a.com/x';
    const lines = parseLines(text);
    const links = linksFor(text, { 'https://a.com/x': pv('https://a.com/x', 'Talk page') });
    const topic: Topic = { id: 't1', name: 'Talks', order: 0, hue: 0, createdAt: 0, lastActivityAt: 0, open: true, sort: 'oldest' };
    const saved = { id: 'i1', topicId: 't1', normUrl: 'a.com/x', url: 'https://a.com/x' } as Item;
    const [d] = buildDrafts(lines, normalizeGroups([{ lines: [1], title: '', mainLink: 'L1', topic: 'Talks', isNew: false }], [1]), links, [topic], [saved]);
    expect(d.source).toBe('duplicate');
    expect(d.include).toBe(false);
  });
});

describe('normalizeGroups', () => {
  it('gives every line exactly one home and keeps lines the AI forgot', () => {
    const g = normalizeGroups(
      [
        { lines: [1, 2, 9], title: 'One', mainLink: null, topic: 'X', isNew: true },
        { lines: [2, 3], title: 'Two', mainLink: null, topic: 'X', isNew: true },
      ],
      [1, 2, 3, 4],
    );
    expect(g.map((x) => [x.title, x.lines])).toEqual([['One', [1, 2]], ['Two', [3]], ['', [4]]]);
    expect(g[2].topic).toBe('Inbox');
  });
});
