import { db } from '../db';
import { deleteTopic, ensureTopicPath, moveTopicTo, renameTopic, setDone, snoozeItem, deleteItem, moveItem } from '../store';
import { descendantIds, indexTree, pathLabel } from '../lib/tree';
import type { Item, Topic } from '../types';
import type { ResolvedAction } from './interpret';

function itemList(ids: string[], items: Item[]): string {
  const titles = ids.map((id) => items.find((i) => i.id === id)?.title).filter(Boolean) as string[];
  const shown = titles.slice(0, 3).map((t) => `“${t.length > 60 ? `${t.slice(0, 60)}…` : t}”`).join(', ');
  return titles.length > 3 ? `${shown} and ${titles.length - 3} more` : shown;
}
const count = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** Plain-language line shown before the user confirms. */
export function describeAction(a: ResolvedAction, topics: Topic[], items: Item[]): string {
  const tree = indexTree(topics);
  const tn = (id: string) => (tree.byId.get(id) ? pathLabel(tree.byId.get(id)!, tree) : 'a topic');
  switch (a.type) {
    case 'move_items':
      return `Move ${count(a.itemIds.length)} to ${a.topicName}${a.topicId ? '' : ' (new topic)'}: ${itemList(a.itemIds, items)}`;
    case 'mark_done':
      return `Mark ${count(a.itemIds.length)} done: ${itemList(a.itemIds, items)}`;
    case 'mark_not_done':
      return `Mark ${count(a.itemIds.length)} not done: ${itemList(a.itemIds, items)}`;
    case 'delete_items':
      return `Delete ${count(a.itemIds.length)}: ${itemList(a.itemIds, items)}`;
    case 'snooze_items':
      return `Snooze ${count(a.itemIds.length)} for ${a.days} day${a.days === 1 ? '' : 's'}: ${itemList(a.itemIds, items)}`;
    case 'create_topic':
      return `Create the topic ${a.name}`;
    case 'rename_topic':
      return `Rename ${tn(a.topicId)} to ${a.newName}`;
    case 'delete_topic': {
      const ids = new Set([a.topicId, ...descendantIds(a.topicId, tree)]);
      const n = items.filter((i) => ids.has(i.topicId)).length;
      const subs = ids.size - 1;
      return `Delete the topic ${tn(a.topicId)}${subs ? `, its ${subs} subfolder${subs === 1 ? '' : 's'}` : ''} and ${count(n)}`;
    }
    case 'set_topic_position':
      return `Move ${tn(a.topicId)} to priority ${a.position}`;
  }
}

export async function applyActions(actions: ResolvedAction[]): Promise<void> {
  for (const a of actions) {
    switch (a.type) {
      case 'move_items': {
        const topicId = a.topicId && (await db.topics.get(a.topicId)) ? a.topicId : await ensureTopicPath(a.path);
        for (const id of a.itemIds) await moveItem(id, topicId);
        await db.topics.update(topicId, { open: true });
        break;
      }
      case 'mark_done':
      case 'mark_not_done':
        for (const id of a.itemIds) await setDone(id, a.type === 'mark_done');
        break;
      case 'delete_items':
        for (const id of a.itemIds) await deleteItem(id);
        break;
      case 'snooze_items':
        for (const id of a.itemIds) await snoozeItem(id, a.days);
        break;
      case 'create_topic':
        await ensureTopicPath(a.path);
        break;
      case 'rename_topic':
        await renameTopic(a.topicId, a.newName);
        break;
      case 'delete_topic':
        await deleteTopic(a.topicId);
        break;
      case 'set_topic_position':
        await moveTopicTo(a.topicId, a.position - 1);
        break;
    }
  }
}
