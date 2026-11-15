import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../app-context';
import { EMBED_MODEL, NAMER_MODEL } from '../local/config';
import type { ModelStorage } from '../local/storage';
import type { IndexState } from '../local/vectors';

const MB = (b: number) => `${Math.round(b / 1e6)} MB`;
const idle: IndexState = { done: 0, total: 0, running: false, error: null };
let vectorsModule: typeof import('../local/vectors') | null = null;

/** Settings for local mode: what's prepared, the naming model, and what's stored in this browser. */
export function LocalPanel({ naming, onNaming }: { naming: boolean; onNaming: (on: boolean) => void }) {
  const { toast } = useApp();
  const [mod, setMod] = useState(vectorsModule);
  const [storage, setStorage] = useState<ModelStorage | null>(null);
  useEffect(() => {
    void import('../local/vectors').then((m) => {
      vectorsModule = m;
      setMod(m);
      void m.syncVectors();
    });
  }, []);
  const state = useSyncExternalStore(mod?.subscribeIndex ?? (() => () => {}), mod?.getIndexState ?? (() => idle));
  const refresh = () => void import('../local/storage').then((s) => s.modelStorage()).then(setStorage).catch(() => setStorage(null));
  useEffect(refresh, [state.running]);

  return (
    <div className="local-panel">
      <p>
        Sorting runs in this browser with <b>{EMBED_MODEL.label}</b>, a small model ({MB(EMBED_MODEL.bytes)} with its runtime) downloaded once from your Stacks server. Nothing you paste is sent
        anywhere. It picks the folder and two others, and spots when a paste continues an item you already have. Splitting a paste into several items, and instructions, need Claude or OpenAI.
      </p>
      <div className="usage-row">
        <span>Saved items prepared</span>
        <span>
          {state.error
            ? 'not available'
            : state.total === 0
              ? 'nothing saved yet'
              : state.running
                ? `${state.done} of ${state.total}…`
                : `all ${state.total} ready`}
        </span>
      </div>
      {state.error && <p className="error">{state.error}</p>}

      <div className="row" style={{ marginTop: 10 }}>
        <input type="checkbox" id="local-naming" checked={naming} onChange={(e) => onNaming(e.target.checked)} />
        <label htmlFor="local-naming">Suggest names for new folders</label>
      </div>
      <small>
        Uses {NAMER_MODEL.label}, a {MB(NAMER_MODEL.bytes)} download the first time you make a new folder. Its names are rough (about a third are keepers), so they appear in a box you can edit.
        The first name in a session takes up to half a minute on a slower computer; later ones a few seconds.
      </small>

      <div className="storage" style={{ marginTop: 10 }}>
        <div>
          <span>Stored in this browser</span>
          <code>
            {storage ? `${MB(storage.embedBytes)} sorting model${storage.namer ? ` · ${MB(storage.namerBytes)} naming model` : ''}` : '…'}
          </code>
        </div>
      </div>
      <div className="row">
        <button
          className="btn ghost small"
          onClick={() =>
            void import('../local/storage')
              .then((s) => s.removeEmbedModel())
              .then(() => {
                toast('Sorting model removed. It downloads again the next time it’s needed.');
                refresh();
              })
          }
        >
          Remove sorting model
        </button>
        {storage?.namer && (
          <button
            className="btn ghost small"
            onClick={() =>
              void import('../local/storage')
                .then((s) => s.removeNamerModel())
                .then(() => {
                  toast('Naming model removed');
                  refresh();
                })
            }
          >
            Remove naming model
          </button>
        )}
      </div>
    </div>
  );
}
