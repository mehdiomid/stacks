import type { Wllama } from '@wllama/wllama';
import { NAMER_IDLE_MS, NAMER_MODEL } from './config';

/*
 * Proposes a new folder, as a whole path "Area › Subfolder", with a small model running in the
 * browser (Qwen3-0.6B). It's told your existing areas and reuses one when it fits. Worked examples
 * come from areas that aren't yours (prompt style "v3" in tests/RESULTS.md), and a grammar forces
 * the shape of the answer. Its proposals are rough: they only pre-fill the Folder box.
 */

const WORD = String.raw`[A-Z0-9] [A-Za-z0-9+'-]{0,19}`;
const PATH_GRAMMAR = `root ::= name " › " name\nname ::= word (" " word)? (" " word)?\nword ::= ${WORD} | "&"\n`;

/** [existing areas, item, answer]: two reuse a listed area, two make a new one. */
const SHOTS: [string, string, string][] = [
  ['Music, Home', 'How to prune tomato plants for bigger harvests', 'Gardening › Vegetables'],
  ['Gardening, Music', 'Learn barre chords on guitar in 10 minutes', 'Music › Guitar'],
  ['Music, Gardening, Home', 'Fixing a leaking kitchen faucet', 'Home › Plumbing'],
  ['Music, Home', "Beginner's guide to film photography", 'Photography › Film Cameras'],
];

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export function folderMessages(item: string, areas: string[]): Message[] {
  const ask = (a: string, it: string) => `Existing areas: ${a || 'none'}\nItem: "${it}"\nFolder (Area › Subfolder):`;
  const turns: Message[] = [
    { role: 'system', content: 'File each item in a folder: a broad area, then a subject of 1 to 3 words, like library shelves. Reuse an existing area when it fits.' },
  ];
  for (const [a, it, ans] of SHOTS) turns.push({ role: 'user', content: ask(a, it) }, { role: 'assistant', content: ans });
  turns.push({ role: 'user', content: ask(areas.slice(0, 20).join(', '), item.slice(0, 300)) });
  return turns;
}

/** Keeps an answer only if it's a usable "Area › Subfolder": two parts, no instruction words, not the same twice. */
export function cleanPath(answer: string): string[] | null {
  const parts = answer
    .split('›')
    .map((p) => p.replace(/\s+/g, ' ').replace(/^[\s"'.,:;-]+|[\s"'.,:;-]+$/g, ''))
    .filter(Boolean);
  if (parts.length !== 2 || parts.some((p) => /\b(area|subject|subfolder|folder|item)\b/i.test(p))) return null;
  if (parts[0].toLowerCase() === parts[1].toLowerCase()) return null;
  return parts;
}

/**
 * What the model is doing, for the tray's message: downloading it (first time only), loading it from
 * the browser's storage, pre-reading the fixed part of the prompt, or proposing a folder.
 */
export type NamerPhase =
  | { phase: 'download'; pct: number }
  | { phase: 'load' }
  | { phase: 'prepare'; device: Device }
  | { phase: 'run'; device: Device };
export type Device = 'gpu' | 'cpu';

interface Loaded {
  w: Wllama;
  device: Device;
}

let current: Promise<Loaded> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let lastPhase: NamerPhase | null = null;
const listeners = new Set<(p: NamerPhase) => void>();
const emit = (p: NamerPhase) => {
  lastPhase = p;
  listeners.forEach((f) => f(p));
};

/**
 * A GPU the browser can use (WebGPU). Without one, in a browser without WebGPU, or when the browser
 * doesn't answer within 3 seconds (some setups never do), the CPU is used.
 */
async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
    return !!(await Promise.race([gpu.requestAdapter(), timeout]));
  } catch {
    return false;
  }
}

async function create(device: Device, downloading: boolean): Promise<Wllama> {
  const { Wllama } = await import('@wllama/wllama');
  const abs = (u: string) => new URL(u, location.href).href;
  const w = new Wllama({ default: abs(NAMER_MODEL.wasm) }, { suppressNativeLog: true });
  // Browsers that need wllama's compat build get it from Stacks, not from a CDN.
  w.setCompat({ worker: abs(NAMER_MODEL.compat.worker), wasm: abs(NAMER_MODEL.compat.wasm) });
  // 4 threads was fastest on the CPU in the assessment; more made it slower.
  const threads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  try {
    await w.loadModelFromUrl(abs(NAMER_MODEL.url), {
      n_ctx: 1024,
      n_gpu_layers: device === 'gpu' ? 99 : 0,
      n_threads: threads,
      progressCallback: ({ loaded, total }) => {
        if (downloading && total) emit({ phase: 'download', pct: Math.round((100 * loaded) / total) });
      },
    });
  } catch (err) {
    await w.exit().catch(() => {});
    throw err;
  }
  return w;
}

/**
 * Pre-read: the instructions and worked examples are the same for every proposal, so the model
 * reads them once right after loading. llama.cpp keeps what it read, and a proposal whose prompt
 * starts with the same text only has to read your areas and the item (~50 tokens instead of ~250).
 */
async function preRead(w: Wllama): Promise<void> {
  // With the grammar too: its first use has a one-time setup cost (~20 s measured on a 2019 laptop CPU).
  await w.createChatCompletion({ messages: folderMessages('', []), max_tokens: 1, temperature: 0, grammar: PATH_GRAMMAR, chat_template_kwargs: { enable_thinking: false } });
}

/** Loads the model (GPU first, then CPU) and pre-reads the fixed part of the prompt. Shared by all callers. */
function start(): Promise<Loaded> {
  current ??= (async () => {
    // Only a model that isn't stored yet is downloading; otherwise the progress is just reading it from storage.
    const downloading = !(await namerCached().catch(() => false));
    emit(downloading ? { phase: 'download', pct: 0 } : { phase: 'load' });
    if (await hasGpu()) {
      try {
        const w = await create('gpu', downloading);
        emit({ phase: 'prepare', device: 'gpu' });
        await preRead(w);
        return { w, device: 'gpu' as const };
      } catch {
        // The GPU couldn't run it (no WebGPU support in wllama here, out of video memory…): use the CPU.
        emit({ phase: 'load' });
      }
    }
    const w = await create('cpu', downloading);
    emit({ phase: 'prepare', device: 'cpu' });
    await preRead(w);
    return { w, device: 'cpu' as const };
  })().catch((err) => {
    current = null;
    throw err;
  });
  return current;
}

/** Frees the model's memory after 3 idle minutes. The download stays in the browser. */
function scheduleUnload() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    const m = current;
    current = null;
    lastPhase = null;
    void m?.then(({ w }) => w.exit()).catch(() => {});
  }, NAMER_IDLE_MS);
}

/**
 * Starts loading and pre-reading in the background (called when you start typing in the box), so a
 * proposal is ready sooner. Unloaded again after 3 idle minutes if no proposal is needed.
 */
export function warmUp(): void {
  clearTimeout(idle);
  void start()
    .then(scheduleUnload)
    .catch(() => {});
}

/** A proposed new folder for an item, as [area, subfolder], or null when the model's answer isn't usable. */
export async function suggestFolderPath(item: string, areas: string[], onPhase?: (p: NamerPhase) => void): Promise<string[] | null> {
  clearTimeout(idle);
  if (onPhase) {
    listeners.add(onPhase);
    if (lastPhase) onPhase(lastPhase);
  }
  try {
    const { w, device } = await start();
    onPhase?.({ phase: 'run', device });
    const r = await w.createChatCompletion({
      messages: folderMessages(item, areas),
      max_tokens: 16,
      temperature: 0,
      grammar: PATH_GRAMMAR,
      chat_template_kwargs: { enable_thinking: false },
    });
    return cleanPath(r.choices[0]?.message?.content ?? '');
  } finally {
    if (onPhase) listeners.delete(onPhase);
    scheduleUnload();
  }
}

/** Whether the naming model is already in this browser (no download needed). */
export async function namerCached(): Promise<boolean> {
  const { CacheManager } = await import('@wllama/wllama');
  const url = new URL(NAMER_MODEL.url, location.href).href;
  const list = await new CacheManager().list();
  return list.some((e) => e.metadata?.originalURL === url);
}

export async function removeNamer(): Promise<void> {
  clearTimeout(idle);
  const m = current;
  current = null;
  lastPhase = null;
  await m?.then(({ w }) => w.exit()).catch(() => {});
  const { CacheManager } = await import('@wllama/wllama');
  await new CacheManager().delete(new URL(NAMER_MODEL.url, location.href).href);
}
