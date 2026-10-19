import { z } from 'zod';
import { AIError } from './errors';
import { callAI } from './call';

export interface ClassifyInput {
  index: number;
  url: string | null;
  site: string;
  title: string;
  description: string;
  /** Text the user wrote next to the link, or the note itself. */
  text: string;
}

export interface ClassifyOutput {
  topic: string;
  isNew: boolean;
  title: string;
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
        required: ['index', 'topic', 'isNew', 'title'],
        properties: {
          index: { type: 'integer', description: 'The index of the input item.' },
          topic: { type: 'string', description: 'An existing topic name exactly as given, a new topic name, or "Inbox".' },
          isNew: { type: 'boolean', description: 'True when topic is not one of the existing topics.' },
          title: { type: 'string', description: 'A clean, short title for the item.' },
        },
      },
    },
  },
};

const Result = z.object({
  items: z.array(z.object({ index: z.number().int(), topic: z.string(), isNew: z.boolean(), title: z.string() })),
});

export const CLASSIFY_SYSTEM = `You sort a person's saved resources (web pages, videos, notes) into their topic lists.

Rules:
- Put each item in the existing topic that fits best. Use the existing name exactly as written.
- Suggest a new topic only when no existing topic fits and the item is clearly about a distinct subject. New names are 1 to 3 words in Title Case, like "Japanese" or "Home Repair". Give related new items the same new name.
- If you can't tell what an item is about, use "Inbox".
- title: for a link, a clean, readable version of its title (drop site names and clutter, at most 90 characters; write one from the URL and text if the title is missing). For a note, a short summary of the note, at most 70 characters.
- Return exactly one entry for every input index.`;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildClassifyPrompt(topics: string[], inputs: ClassifyInput[]): string {
  const payload = {
    topics_in_priority_order: topics,
    items: inputs.map((i) => ({
      index: i.index,
      ...(i.url ? { url: truncate(i.url, 200), site: i.site } : {}),
      ...(i.title ? { title: truncate(i.title, 160) } : {}),
      ...(i.description ? { description: truncate(i.description, 200) } : {}),
      ...(i.text ? { text: truncate(i.text, 300) } : {}),
    })),
  };
  return `Sort these items.\n\n${JSON.stringify(payload)}`;
}

/** One AI call for a whole batch. Returns topic + title per input index. */
export async function classify(topics: string[], inputs: ClassifyInput[]): Promise<{ results: Map<number, ClassifyOutput>; tokens: number; model: string }> {
  if (!inputs.length) return { results: new Map(), tokens: 0, model: '' };
  const { json, tokens, model } = await callAI({
    system: CLASSIFY_SYSTEM,
    user: buildClassifyPrompt(topics, inputs),
    schema,
    schemaName: 'sorted_items',
    maxTokens: Math.min(16000, 1500 + inputs.length * 120),
  });
  const parsed = Result.safeParse(json);
  if (!parsed.success) throw new AIError('bad-output', 'The AI reply was not in the expected format. Try again.');
  const results = new Map<number, ClassifyOutput>();
  for (const r of parsed.data.items) results.set(r.index, { topic: r.topic.trim(), isNew: r.isNew, title: r.title.trim() });
  return { results, tokens, model };
}
