/// <reference lib="webworker" />
// Runs the embedding model off the main thread, so the page never freezes.
// Model files come from the Stacks server (/models/), never from a third party.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBED_MODEL, MODELS_BASE } from './config';
// The package doesn't export these files, so they're imported by path.
import ortMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${MODELS_BASE}/`;
// Keeps a copy in the browser (Cache API), so later visits load without downloading.
env.useBrowserCache = true;
// The ONNX runtime would otherwise load these from a CDN. Bundled instead, so they come from Stacks.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

export type EmbedRequest = { id: number; texts: string[] };
export type EmbedResponse = { id: number; vectors?: Float32Array[]; error?: string } | { progress: number };

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const load = () =>
  (extractor ??= pipeline('feature-extraction', EMBED_MODEL.repo, {
    dtype: EMBED_MODEL.dtype,
    device: 'wasm',
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') self.postMessage({ progress: p.progress } satisfies EmbedResponse);
    },
  }) as Promise<FeatureExtractionPipeline>);

self.onmessage = async (e: MessageEvent<EmbedRequest>) => {
  const { id, texts } = e.data;
  try {
    const run = await load();
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 8) {
      const t = await run(texts.slice(i, i + 8), { pooling: EMBED_MODEL.pooling, normalize: true });
      const [n, d] = t.dims as [number, number];
      const data = t.data as Float32Array;
      for (let k = 0; k < n; k++) vectors.push(data.slice(k * d, (k + 1) * d));
    }
    self.postMessage({ id, vectors } satisfies EmbedResponse);
  } catch (err) {
    extractor = null;
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies EmbedResponse);
  }
};
