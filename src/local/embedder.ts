import type { EmbedRequest, EmbedResponse } from './embed.worker';

/** Errors that mean local mode can't run here (no model files on the server, old browser…). */
export class LocalUnavailable extends Error {}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(p: number) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') throw new LocalUnavailable('This browser cannot run local models. Use Claude or OpenAI in Settings.');
  worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<EmbedResponse>) => {
    const m = e.data;
    if ('progress' in m) return progressListeners.forEach((f) => f(m.progress));
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new LocalUnavailable(`The local model could not run: ${m.error}`));
    else p.resolve(m.vectors ?? []);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new LocalUnavailable(`The local model could not start: ${e.message}`));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Embeds texts in the background worker. The model loads on the first call. */
export function embed(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, texts } satisfies EmbedRequest);
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}

/** Download progress (0–100) while the model loads for the first time. */
export function onModelProgress(f: (p: number) => void): () => void {
  progressListeners.add(f);
  return () => progressListeners.delete(f);
}
