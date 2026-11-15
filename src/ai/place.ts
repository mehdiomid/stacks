import { z } from 'zod';
import type { ParsedLine } from '../lib/parse';
import { AIError } from './errors';
import { callAI } from './call';
import { renderLines, type LinkInfo } from './group';

/** A folder as the AI sees it: its full path and the latest items saved in it. */
export interface PlaceFolder {
  path: string;
  recent: { ref: string; title: string }[];
}

export interface Placement {
  title: string;
  /** Ref of the link that best represents the item (L2), or null. */
  mainLink: string | null;
  topic: string;
  /** Up to 2 other folders that could fit, best first. */
  alternatives: string[];
  /** Ref of an existing item (i3) that this continues, or null. */
  joinItem: string | null;
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'mainLink', 'topic', 'alternatives', 'joinItem'],
  properties: {
    title: { type: 'string', description: 'Short, specific title for the item.' },
    mainLink: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Ref like "L2" of the link that best represents the item, or null.' },
    topic: { type: 'string', description: 'A folder path at least 2 levels deep ("Area › Subject"), existing as listed or new; or "Inbox".' },
    alternatives: { type: 'array', items: { type: 'string' }, description: 'Up to 2 other folders that could fit, best first.' },
    joinItem: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Ref like "i3" of an existing item this continues, or null.' },
  },
};

const Result = z.object({
  title: z.string(),
  mainLink: z.string().nullable(),
  topic: z.string(),
  alternatives: z.array(z.string()),
  joinItem: z.string().nullable(),
});

export const PLACE_SYSTEM = `Everything the person pasted is ONE item to save: a post, a course, a talk with its links, a note. Give it a title and find where it belongs.

The text comes as numbered lines. Links appear as [L1], [L2]…; what each link's page is about is listed after the text. The person's folders are listed as full paths, each with the latest items saved in it (refs like i3).

1. title: short and specific, at most 80 characters, naming the thing itself (e.g. "Vizuara: Modern Robot Learning from Scratch"). For a single link whose page title is clear, use that page title.
2. mainLink: the link that best represents the item (the video for a talk, the article for a post), or null when there are no links.
3. topic: a folder path at least 2 levels deep, like "Robotics › Robot Learning": a broad area, then the subject inside it (at most 3 levels).
   - Use the most specific existing folder that fits, written exactly as listed. A folder whose items are closely related to this one is a strong match.
   - When only a top-level folder fits, choose one of its subfolders, or a new one inside it ("Robotics › Grippers").
   - When nothing fits, make a new path of 2 levels ("Cooking › Pizza"). New names are 1 to 3 words in Title Case.
   - A line ending in {in: X} means the person chose folder X: answer "X › Subfolder" with an existing or new subfolder of X.
   - Use "Inbox" (the only 1-level answer) when you can't tell.
4. alternatives: up to 2 other folders that could also fit, best first, written the same way. Empty when nothing else fits.
5. joinItem: the ref of an existing item that this is a part of, or null.
   - Join only when the new text continues that exact item: another lecture or part of the same named course or series, the slides or recording of the same talk, a follow-up to the same post or project.
   - Both titles must name the same course, series, talk or project. Check the names, not just the subject.
   - Never join because both are courses, lectures, papers or videos, or because both are about the same field. "Lecture 5 of Stanford CS231n" does not join "MIT Deep Learning course".
   - When in doubt, null.`;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildPlacePrompt(folders: PlaceFolder[], lines: ParsedLine[], links: LinkInfo[], refOf: Map<string, string>): string {
  const folderLines = folders.map((f) => `"${f.path}"${f.recent.length ? `\n${f.recent.map((r) => `  ${r.ref} | ${cut(r.title, 80)}`).join('\n')}` : ''}`);
  const linkLines = links.map((l) => `${l.ref}: ${cut(l.url, 160)} | ${l.site}${l.title ? ` | ${cut(l.title, 140)}` : ''}${l.description ? ` | ${cut(l.description, 160)}` : ''}`);
  return [
    'Folders, most important first, with their latest items:',
    folderLines.join('\n') || '(none yet)',
    '',
    'Text:',
    renderLines(lines, refOf),
    '',
    'Links:',
    linkLines.join('\n') || '(none)',
  ].join('\n');
}

export async function placeItem(folders: PlaceFolder[], lines: ParsedLine[], links: LinkInfo[], refOf: Map<string, string>): Promise<{ placement: Placement; model: string }> {
  const { json, model } = await callAI({
    system: PLACE_SYSTEM,
    user: buildPlacePrompt(folders, lines, links, refOf),
    schema,
    schemaName: 'placed_item',
    maxTokens: 1200,
  });
  const parsed = Result.safeParse(json);
  if (!parsed.success) throw new AIError('bad-output', 'The AI reply was not in the expected format. Try again.');
  const p = parsed.data;
  return {
    placement: {
      title: p.title.trim(),
      mainLink: p.mainLink,
      topic: p.topic.trim(),
      alternatives: p.alternatives.map((a) => a.trim()).filter(Boolean).slice(0, 2),
      joinItem: p.joinItem?.trim() || null,
    },
    model,
  };
}
