import { describe, expect, it } from 'vitest';
import { joinHeadings, normalizeGroups } from './ai/group';
import { atLeastTwoLevels, buildDrafts, choiceForName, choiceInside, foldersForAI, toLinkData, type LinkData } from './ingest';
import { buildPlacePrompt, PLACE_SYSTEM } from './ai/place';
import { indexTree } from './lib/tree';
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
    const groups = normalizeGroups([{ lines: lines.map((l) => l.n), title: 'Open models lecture: state of the ecosystem', mainLink: 'L1', topic: 'AI › Open Models', isNew: true }], lines.map((l) => l.n));
    const drafts = buildDrafts(lines, groups, links, [], []);

    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.title).toBe('Open models lecture: state of the ecosystem');
    expect(d.url).toBe('https://www.youtube.com/watch?v=abc');
    expect(d.kind).toBe('video');
    expect(d.choice).toBe('new:AI\\Open Models');
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

describe('folder paths you write', () => {
  const t = (id: string, name: string, order: number, parentId: string | null = null): Topic => ({
    id, name, order, parentId, hue: 0, createdAt: 0, lastActivityAt: 0, open: true, sort: 'oldest',
  });
  const topics = [t('rob', 'Robotics', 0), t('pap', 'Papers', 0, 'rob'), t('ml', 'Machine Learning', 1)];

  it('puts items in an existing folder, or a new path under the existing part', () => {
    const text = '\\robotics\\papers\nhttps://a.com/1\n\\robotics\\grippers\nhttps://b.com/2\nhttps://c.com/3 \\"Open Models"';
    const lines = parseLines(text);
    const links = linksFor(text, {});
    const groups = normalizeGroups(lines.map((l) => ({ lines: [l.n], title: '', mainLink: null, topic: 'Open Models › Papers', isNew: true })), lines.map((l) => l.n));
    const drafts = buildDrafts(lines, groups, links, topics, []);
    expect(drafts.map((d) => [d.choice, d.source])).toEqual([
      ['pap', 'path'],
      ['new:Robotics\\Grippers', 'path'],
      // One level written: the AI's subfolder inside it.
      ['new:Open Models\\Papers', 'path'],
    ]);
  });

  it('splits an item the AI grouped across a path line', () => {
    const text = 'Intro to a talk\nhttps://a.com/1\n\\cooking\nhttps://pizza.com/2';
    const lines = parseLines(text);
    const groups = normalizeGroups([{ lines: [1, 2, 3], title: 'Talk', mainLink: 'L1', topic: 'Pizza', isNew: true }], [1, 2, 3]);
    const drafts = buildDrafts(lines, groups, linksFor(text, {}), topics, []);
    expect(drafts.map((d) => [d.url, d.choice])).toEqual([
      ['https://a.com/1', 'new:Inbox'],
      ['https://pizza.com/2', 'new:Cooking\\Pizza'],
    ]);
  });

  it('matches the AI topic by path or name, and makes new subfolders under existing folders', () => {
    expect(choiceForName('Robotics › Papers', topics)).toBe('pap');
    expect(choiceForName('machine-learning', topics)).toBe('ml');
    expect(choiceForName('Robotics › grippers', topics)).toBe('new:Robotics\\Grippers');
    expect(choiceForName('open models', topics)).toBe('new:Open Models');
  });

  it('files sorted items at least 2 levels deep', () => {
    const tree = indexTree(topics);
    expect(atLeastTwoLevels(choiceForName('Robotics › Papers', topics), topics, tree)).toBe('pap');
    expect(atLeastTwoLevels(choiceForName('Robotics', topics), topics, tree)).toBe('new:Inbox');
    expect(atLeastTwoLevels(choiceForName('Cooking', topics), topics, tree)).toBe('new:Inbox');
    expect(atLeastTwoLevels(choiceForName('Inbox', topics), topics, tree)).toBe('new:Inbox');
    // \robotics written: the AI picks the subfolder; a stray answer becomes one inside Robotics.
    expect(choiceInside('Robotics', 'Robotics › Papers', topics, tree)).toBe('pap');
    expect(choiceInside('Robotics', 'Papers', topics, tree)).toBe('pap');
    expect(choiceInside('Robotics', 'Machine Learning', topics, tree)).toBe('new:Robotics\\Machine Learning');
    expect(choiceInside('Robotics', 'Inbox', topics, tree)).toBe('rob');
  });
});

describe('a course pasted with a heading and numbered lectures', () => {
  const topics: Topic[] = [{ id: 'rob', name: 'Robotics', order: 0, parentId: null, hue: 0, createdAt: 0, lastActivityAt: 0, open: true, sort: 'oldest' }];
  const COURSE = `Vizuara robotics from scratch

Lecture 3 - Deep Generative Modeling | Variational AutoEncoders | Modern Robot Learning from Scratch
2- https://www.youtube.com/watch?v=BCkiHJHn990

3- Lecture 4 - The Transformer Architecture for Robotics | Modern Robot Learning from Scratch

https://www.youtube.com/watch?v=8otn0N8Lwkw`;

  it('reads "2-" and "3-" as numbering, not text', () => {
    const lines = parseLines(COURSE);
    expect(lines[2].raw).toBe('https://www.youtube.com/watch?v=BCkiHJHn990');
    expect(lines[3].raw).toMatch(/^Lecture 4/);
    expect(parseLines('2024 - a good year')[0].raw).toBe('2024 - a good year');
  });

  it('never leaves the heading alone, and keeps the AI from splitting a course in three', () => {
    const lines = parseLines(COURSE);
    const g = (ls: number[], topic = 'Robotics › Robot Learning') => ({ lines: ls, title: '', mainLink: null, topic, isNew: true });
    expect(joinHeadings([g([1]), g([2, 3]), g([4, 5])], lines).map((x) => x.lines)).toEqual([[1, 2, 3], [4, 5]]);
    // A list of short notes is not a heading for the next note.
    const notes = parseLines('Buy milk\nCall mom');
    expect(joinHeadings([g([1]), g([2])], notes)).toHaveLength(2);

    const links = linksFor(COURSE, {});
    const [d, ...rest] = buildDrafts(lines, [{ lines: [1, 2, 3, 4, 5], title: 'Vizuara: Modern Robot Learning from Scratch', mainLink: 'L1', topic: 'Robotics › Robot Learning', isNew: true }], links, topics, []);
    expect(rest).toHaveLength(0);
    expect(d.links?.map((l) => l.url)).toEqual(['https://www.youtube.com/watch?v=BCkiHJHn990', 'https://www.youtube.com/watch?v=8otn0N8Lwkw']);
    expect(d.choice).toBe('new:Robotics\\Robot Learning');
    expect(d.description).not.toMatch(/^2\b|\n2\n/);
  });
});

describe('one item from the whole paste (the default)', () => {
  const t = (id: string, name: string, order: number, parentId: string | null = null): Topic => ({
    id, name, order, parentId, hue: 0, createdAt: 0, lastActivityAt: 0, open: true, sort: 'oldest',
  });
  const topics = [t('rob', 'Robotics', 0), t('rl', 'Robot Learning', 0, 'rob'), t('ck', 'Cooking', 1)];

  it('keeps everything together, even across a path line, and uses the first folder written', () => {
    const text = 'Vizuara robotics from scratch\nhttps://a.com/1\n\\robotics\\robot-learning\nLecture 4\nhttps://a.com/2\n\\cooking\\pizza';
    const lines = parseLines(text);
    const drafts = buildDrafts(lines, [{ lines: lines.map((l) => l.n), title: 'Vizuara course', mainLink: null, topic: '', isNew: false }], linksFor(text, {}), topics, [], { single: true });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].links).toHaveLength(2);
    expect([drafts[0].choice, drafts[0].source]).toEqual(['rl', 'path']);
    expect(drafts[0].notes).toContain('Vizuara robotics from scratch');
  });

  it('shows the AI each folder with its latest items, newest first', () => {
    const item = (id: string, topicId: string, title: string, addedAt: number) => ({ id, topicId, title, addedAt }) as Item;
    const items = [item('a', 'rl', 'Old robot paper', 1), item('b', 'rl', 'Vizuara: Robot Learning from Scratch', 9), item('c', 'ck', 'Pizza dough', 5)];
    const { folders, itemOf } = foldersForAI(topics, items);
    expect(folders.map((f) => [f.path, f.recent.map((r) => r.title)])).toEqual([
      ['Robotics', []],
      ['Robotics › Robot Learning', ['Vizuara: Robot Learning from Scratch', 'Old robot paper']],
      ['Cooking', ['Pizza dough']],
    ]);
    expect(itemOf.get('i1')?.id).toBe('b');
    const prompt = buildPlacePrompt(folders, parseLines('Lecture 5 https://a.com/5'), [], new Map([['https://a.com/5', 'L1']]));
    expect(prompt).toContain('"Robotics › Robot Learning"\n  i1 | Vizuara: Robot Learning from Scratch');
    expect(prompt).toContain('1| Lecture 5 [L1]');
  });

  it('tells the AI to join only the same named course or series, never just the same kind', () => {
    expect(PLACE_SYSTEM).toMatch(/same named course or series/);
    expect(PLACE_SYSTEM).toMatch(/Never join because both are courses/);
  });
});
