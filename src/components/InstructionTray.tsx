import { describeAction } from '../ai/actions';
import type { ResolvedAction } from '../ai/interpret';
import type { Item, Topic } from '../types';

interface Props {
  plan: { summary: string; actions: ResolvedAction[] };
  topics: Topic[];
  items: Item[];
  onApply: () => void;
  onCancel: () => void;
}

export function InstructionTray({ plan, topics, items, onApply, onCancel }: Props) {
  const n = plan.actions.length;
  const destructive = plan.actions.some((a) => a.type === 'delete_items' || a.type === 'delete_topic');
  return (
    <div className="tray" role="region" aria-label="Review changes">
      <h3>{n ? `${n} change${n === 1 ? '' : 's'} to make` : 'Nothing to change'}</h3>
      <div className="sub">{plan.summary}</div>
      {n > 0 && (
        <ol className="action-list">
          {plan.actions.map((a, i) => (
            <li key={i} className={a.type.startsWith('delete') ? 'destructive' : ''}>
              {describeAction(a, topics, items)}
            </li>
          ))}
        </ol>
      )}
      <div className="tray-actions">
        <button className="btn ghost" onClick={onCancel}>
          {n ? 'Cancel' : 'Close'}
        </button>
        {n > 0 && (
          <button className={`btn ${destructive ? 'danger' : ''}`} onClick={onApply}>
            Apply {n} change{n === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}
