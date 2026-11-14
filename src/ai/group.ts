import { z } from 'zod';
import type { ParsedLine } from '../lib/parse';
import { AIError } from './errors';
import { callAI } from './call';

/** What the AI knows about each link, referenced as L1, L2… in the numbered lines. */
export interface LinkInfo {
  ref: string;
  url: string;
  site: string;
  title: string;
  description: string;
}

export interface Group {
  lines: number[];
  title: string;
  /** Ref of the link that best represents the item (L2), or null. */
  mainLink: string | null;
  topic: string;
  isNew: boolean;
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lines', 'title', 'mainLink', 'topic', 'isNew'],
        properties: {
          lines: { type: 'array', items: { type: 'integer' }, description: 'Line numbers that make up this item.' },
          title: { type: 'string', description: 'Short, specific title for the item.' },
          mainLink: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Ref like "L2" of the link that best represents the item, or null.' },
          topic: { type: 'string', description: 'A folder path at least 2 levels deep ("Area › Subject"), existing as listed or new; or "Inbox".' },
          isNew: { type: 'boolean', description: 'True when topic is not one of the existing topics.' },
        },
      },
    },
  },
};

const Result = z.object({
  items: z.array(z.object({ lines: z.array(z.number().int()), title: z.string(), mainLink: z.string().nullable(), topic: z.string(), isNew: z.boolean() })),
});

export const GROUP_SYSTEM = `You organize a person's pasted notes and links into saved items, and file each item in a topic.

The text comes as numbered lines. Links appear as [L1], [L2]…; what each link's page is about is listed after the text.

1. Group lines into items. An item is one thing the person wants to read, watch or remember.
   - Lines that belong together form ONE item: a post or announcement together with its video, slides and reading-list links; a paragraph and the questions under it; a heading followed by its link.
   - A short line without a link at the top of a block (a course, series, playlist or channel name) is a heading: it belongs to the item of the lines under it, never an item on its own.
   - Lectures, lessons, parts or episodes of the same course or series are ONE item that lists every link, even when they are numbered or separated by blank lines.
   - Split only when the subject really changes. Blank lines and numbering alone don't make separate items.
   - Unrelated lines stay separate: a list of different links or different ideas is one item per line.
2. Every line number goes in exactly one item.
3. title: short and specific, at most 80 characters (e.g. "Open models lecture: state of the open ecosystem"). For an item that is a single link whose page title is clear, use that page title.
4. mainLink: the link that best represents the item (the video for a talk, the article for a post), or null when the item has no links.
5. topic: a folder path at least 2 levels deep, like "Robotics › Robot Learning": a broad area, then the subject inside it (at most 3 levels). Folders are listed as full paths.
   - Use the most specific existing folder that fits, written exactly as listed, when it is 2 or more levels deep.
   - When only a top-level folder fits, choose one of its subfolders, or a new one inside it ("Robotics › Grippers").
   - When nothing fits, make a new path of 2 levels ("Cooking › Pizza").
   - New names are 1 to 3 words in Title Case, and related new items share the same path.
   - A line ending in {in: X} goes inside X, which the person chose: answer "X › Subfolder" with an existing or new subfolder of X.
   - Use "Inbox" (the only 1-level answer) when you can't tell.`;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Lines with links replaced by their refs, and a blank line kept at paragraph breaks. */
export function renderLines(lines: ParsedLine[], refOf: Map<string, string>): string {
  return lines
    .map((l) => {
      let t = l.raw;
      for (const u of l.urls) t = t.replace(u, `[${refOf.get(u) ?? '?'}]`);
      // A one-level folder you wrote: the AI picks the subfolder inside it.
      const only = l.folder ?? l.section;
      const inside = only?.length === 1 ? ` {in: ${only[0]}}` : '';
      return `${l.blankBefore ? '\n' : ''}${l.n}| ${cut(t, 400)}${inside}`;
    })
    .join('\n');
}

export function buildGroupPrompt(topics: string[], lines: ParsedLine[], links: LinkInfo[], refOf: Map<string, string>): string {
  const linkLines = links.map((l) => `${l.ref}: ${cut(l.url, 160)} | ${l.site}${l.title ? ` | ${cut(l.title, 140)}` : ''}${l.description ? ` | ${cut(l.description, 160)}` : ''}`);
  return [
    `Existing topics, most important first: ${topics.length ? topics.map((t) => `"${t}"`).join(', ') : '(none yet)'}`,
    '',
    'Text:',
    renderLines(lines, refOf),
    '',
    'Links:',
    linkLines.join('\n') || '(none)',
  ].join('\n');
}

/**
 * Makes the AI's grouping safe to use: each line in exactly one group (first claim wins),
 * unknown line numbers dropped, any line the AI left out kept as its own item in Inbox.
 */
export function normalizeGroups(groups: Group[], lineNumbers: number[]): Group[] {
  const valid = new Set(lineNumbers);
  const taken = new Set<number>();
  const out: Group[] = [];
  for (const g of groups) {
    const lines = [...new Set(g.lines)].filter((n) => valid.has(n) && !taken.has(n)).sort((a, b) => a - b);
    if (!lines.length) continue;
    lines.forEach((n) => taken.add(n));
    out.push({ ...g, lines });
  }
  for (const n of lineNumbers) if (!taken.has(n)) out.push({ lines: [n], title: '', mainLink: null, topic: 'Inbox', isNew: false });
  return out.sort((a, b) => a.lines[0] - b.lines[0]);
}

/** A line that only names what follows: short, no link, not a sentence. */
const isHeading = (l: ParsedLine | undefined) => !!l && !l.urls.length && !!l.text && l.text.length <= 80 && !/[.?!:]$/.test(l.text);
const folderKey = (l: ParsedLine | undefined) => (l?.folder ?? l?.section ?? []).join('\\').toLowerCase();

/**
 * Safety net: a heading the AI left on its own ("Vizuara robotics from scratch") joins the
 * item right below it, when that item has links and sits in the same folder.
 */
export function joinHeadings(groups: Group[], lines: ParsedLine[]): Group[] {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const out: Group[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const next = groups[i + 1];
    const alone = g.lines.length === 1 && isHeading(byN.get(g.lines[0]));
    if (alone && next && next.lines[0] === g.lines[0] + 1 && next.lines.some((n) => byN.get(n)?.urls.length) && folderKey(byN.get(g.lines[0])) === folderKey(byN.get(next.lines[0]))) {
      groups[i + 1] = { ...next, lines: [g.lines[0], ...next.lines] };
      continue;
    }
    out.push(g);
  }
  return out;
}

export async function groupLines(topics: string[], lines: ParsedLine[], links: LinkInfo[], refOf: Map<string, string>): Promise<{ groups: Group[]; model: string }> {
  const { json, model } = await callAI({
    system: GROUP_SYSTEM,
    user: buildGroupPrompt(topics, lines, links, refOf),
    schema,
    schemaName: 'grouped_items',
    maxTokens: Math.min(16000, 1500 + lines.length * 60),
  });
  const parsed = Result.safeParse(json);
  if (!parsed.success) throw new AIError('bad-output', 'The AI reply was not in the expected format. Try again.');
  const groups = parsed.data.items.map((g) => ({ ...g, title: g.title.trim(), topic: g.topic.trim() }));
  return { groups: joinHeadings(normalizeGroups(groups, lines.map((l) => l.n)), lines), model };
}
