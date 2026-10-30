import { z } from 'zod';
import { findByName, flattenTree, indexTree, MAX_DEPTH, pathOf, PATH_SEP, splitPathName } from '../lib/tree';
import type { Item, Topic } from '../types';
import { AIError } from './errors';
import { callAI } from './call';

export const ACTION_TYPES = [
  'move_items',
  'mark_done',
  'mark_not_done',
  'snooze_items',
  'delete_items',
  'create_topic',
  'rename_topic',
  'delete_topic',
  'set_topic_position',
] as const;

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string', description: 'One short sentence saying what will happen, or why nothing can be done.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'itemRefs', 'topic', 'newName', 'position', 'days'],
        properties: {
          type: { type: 'string', enum: [...ACTION_TYPES] },
          itemRefs: { type: 'array', items: { type: 'string' }, description: 'Item refs like "i12". Empty when not used.' },
          topic: { ...nullable('string'), description: 'Topic as listed (full path for nested ones, like "Robotics › Papers"). For move_items and create_topic, may be a new path.' },
          newName: { ...nullable('string'), description: 'New topic name, for rename_topic.' },
          position: { ...nullable('integer'), description: '1-based position among the topics in the same folder, for set_topic_position. 1 is most important.' },
          days: { ...nullable('integer'), description: 'Number of days, for snooze_items.' },
        },
      },
    },
  },
};

const Result = z.object({
  summary: z.string(),
  actions: z.array(
    z.object({
      type: z.enum(ACTION_TYPES),
      itemRefs: z.array(z.string()),
      topic: z.string().nullable(),
      newName: z.string().nullable(),
      position: z.number().int().nullable(),
      days: z.number().int().nullable(),
    }),
  ),
});

export type ResolvedAction =
  | { type: 'move_items'; itemIds: string[]; topicId: string | null; topicName: string; path: string[] }
  | { type: 'mark_done' | 'mark_not_done' | 'delete_items'; itemIds: string[] }
  | { type: 'snooze_items'; itemIds: string[]; days: number }
  | { type: 'create_topic'; name: string; path: string[] }
  | { type: 'rename_topic'; topicId: string; newName: string }
  | { type: 'delete_topic'; topicId: string }
  | { type: 'set_topic_position'; topicId: string; position: number };

export const INTERPRET_SYSTEM = `You turn a person's instruction about their reading and watching lists into actions.

- Use only the action types in the schema. Leave unused fields null (or an empty list for itemRefs).
- Refer to items only by their ref (like "i12") from the list you are given. Match items by meaning, not just exact words.
- Refer to topics exactly as listed. Topics can be folders inside folders (at most 3 levels), listed as full paths like "Robotics › Papers".
- The person may write a folder as a path with backslashes: \\robotics\\papers means "Robotics › Papers".
- For move_items or create_topic to a topic that doesn't exist yet, give the new full path; missing folders will be created.
- set_topic_position uses 1 for the most important topic within its folder.
- If the instruction is unclear or not about these lists, return no actions and say why in summary.`;

const MAX_ITEMS_IN_PROMPT = 400;

export async function interpret(instruction: string, topics: Topic[], items: Item[]): Promise<{ summary: string; actions: ResolvedAction[]; tokens: number }> {
  const tree = indexTree(topics);
  const flat = flattenTree(topics, tree);
  const topicName = new Map(flat.map((f) => [f.topic.id, f.path.join(PATH_SEP)]));
  const rank = new Map(flat.map((f, i) => [f.topic.id, i]));
  // Unfinished items first, then by topic priority, so the most relevant ones fit in the prompt.
  const listed = [...items]
    .sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt) || (rank.get(a.topicId) ?? 99) - (rank.get(b.topicId) ?? 99) || a.addedAt - b.addedAt)
    .slice(0, MAX_ITEMS_IN_PROMPT);
  const refToId = new Map(listed.map((it, i) => [`i${i + 1}`, it.id]));
  const lines = listed.map((it, i) => `i${i + 1} | ${topicName.get(it.topicId) ?? '?'} | ${it.doneAt ? 'done' : 'open'} | ${it.title.slice(0, 90)}${it.siteName ? ` | ${it.siteName}` : ''}`);
  const topicLines = flat.map((f, i) => {
    const n = items.filter((x) => x.topicId === f.topic.id);
    return `${i + 1}. ${f.path.join(PATH_SEP)} (${n.filter((x) => !x.doneAt).length} open, ${n.filter((x) => x.doneAt).length} done)`;
  });
  const user = `Topics, most important first:\n${topicLines.join('\n') || '(none yet)'}\n\nItems:\n${lines.join('\n') || '(none yet)'}\n\nInstruction: ${instruction}`;

  const { json, tokens } = await callAI({ system: INTERPRET_SYSTEM, user, schema, schemaName: 'list_actions', maxTokens: 6000 });
  const parsed = Result.safeParse(json);
  if (!parsed.success) throw new AIError('bad-output', 'The AI reply was not in the expected format. Try again.');

  const byName = (name: string | null) => (name ? findByName(name, topics, tree) ?? undefined : undefined);
  const newPath = (name: string) => splitPathName(name).slice(0, MAX_DEPTH);
  const ids = (refs: string[]) => [...new Set(refs.map((r) => refToId.get(r.trim())).filter((x): x is string => !!x))];

  const actions: ResolvedAction[] = [];
  for (const a of parsed.data.actions) {
    switch (a.type) {
      case 'move_items': {
        const itemIds = ids(a.itemRefs);
        if (!itemIds.length || !a.topic?.trim()) break;
        const t = byName(a.topic);
        const path = t ? pathOf(t, tree).map((x) => x.name) : newPath(a.topic);
        if (path.length) actions.push({ type: 'move_items', itemIds, topicId: t?.id ?? null, topicName: path.join(PATH_SEP), path });
        break;
      }
      case 'mark_done':
      case 'mark_not_done':
      case 'delete_items': {
        const itemIds = ids(a.itemRefs);
        if (itemIds.length) actions.push({ type: a.type, itemIds });
        break;
      }
      case 'snooze_items': {
        const itemIds = ids(a.itemRefs);
        if (itemIds.length) actions.push({ type: 'snooze_items', itemIds, days: Math.max(1, Math.min(365, a.days ?? 3)) });
        break;
      }
      case 'create_topic':
        if (a.topic?.trim() && !byName(a.topic) && newPath(a.topic).length) actions.push({ type: 'create_topic', name: newPath(a.topic).join(PATH_SEP), path: newPath(a.topic) });
        break;
      case 'rename_topic': {
        const t = byName(a.topic);
        if (t && a.newName?.trim()) actions.push({ type: 'rename_topic', topicId: t.id, newName: a.newName.trim() });
        break;
      }
      case 'delete_topic': {
        const t = byName(a.topic);
        if (t) actions.push({ type: 'delete_topic', topicId: t.id });
        break;
      }
      case 'set_topic_position': {
        const t = byName(a.topic);
        if (t && a.position) {
          const siblings = tree.children(tree.parentOf(t)).length;
          actions.push({ type: 'set_topic_position', topicId: t.id, position: Math.max(1, Math.min(siblings, a.position)) });
        }
        break;
      }
    }
  }
  return { summary: parsed.data.summary, actions, tokens };
}
