/** Where the Stacks server serves the local-mode model files (see scripts/fetch-models.mjs). */
export const MODELS_BASE = '/models';

/** Chooses folders and finds items a paste continues. 23 MB; chosen in tests/RESULTS.md. */
export const EMBED_MODEL = {
  id: 'arctic-embed-xs',
  repo: 'Snowflake/snowflake-arctic-embed-xs',
  dtype: 'q8',
  pooling: 'cls',
  label: 'snowflake-arctic-embed-xs',
  bytes: 22_972_992 + 711_649 + 26_900_000, // model + tokenizer + ONNX runtime (uncompressed)
} as const;

/** Proposes new folders (Area › Subfolder) when nothing fits. On by default; downloaded the first time it's needed. */
export const NAMER_MODEL = {
  id: 'qwen3-0.6b',
  url: `${MODELS_BASE}/unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf`,
  wasm: `${MODELS_BASE}/wllama/wllama.wasm`,
  /** For browsers without JSPI or Memory64: served by Stacks instead of wllama's CDN default. */
  compat: { worker: `${MODELS_BASE}/wllama/compat/wllama.js`, wasm: `${MODELS_BASE}/wllama/compat/wllama.wasm` },
  label: 'Qwen3-0.6B',
  bytes: 396_705_472,
} as const;

/** The naming model is unloaded after this long without use, to give back about 0.9 GB of memory. */
export const NAMER_IDLE_MS = 3 * 60_000;
