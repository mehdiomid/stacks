import type { Wllama } from '@wllama/wllama';
import { NAMER_IDLE_MS, NAMER_MODEL } from './config';

/*
 * Suggests a name for a new folder with a small model running in the browser (Qwen3-0.6B).
 * The prompt is "v3" from tests/RESULTS.md: ask what the item is about, with worked examples
 * from areas that aren't yours, and force the shape of the answer with a grammar.
 * Its names are rough: the tray always shows them in an editable box.
 */

const WORD = String.raw`[A-Z0-9] [A-Za-z0-9+'-]{0,19}`;
const NAME_GRAMMAR = `root ::= word (" " word)? (" " word)?\nword ::= ${WORD} | "&"\n`;
const PATH_GRAMMAR = `root ::= name " › " name\nname ::= word (" " word)? (" " word)?\nword ::= ${WORD} | "&"\n`;

const SHOTS_TOPIC: [string, string][] = [
  ['How to prune tomato plants for bigger harvests', 'Vegetables'],
  ['Learn barre chords on guitar in 10 minutes', 'Guitar'],
  ['Fixing a leaking kitchen faucet', 'Plumbing'],
  ['Watercolor techniques for beginners', 'Painting'],
];
const SHOTS_AREA: [string, string][] = [
  ["Beginner's guide to film photography", 'Photography › Film Cameras'],
  ['How to learn Spanish vocabulary fast', 'Languages › Spanish'],
];

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export function namingMessages(item: string, withArea: boolean): Message[] {
  const turns: Message[] = [{ role: 'system', content: 'Say what subject an item is about, in 1 to 3 words, like a library shelf label.' }];
  const ask = withArea ? 'Area › Subject:' : 'Subject:';
  for (const [it, a] of withArea ? SHOTS_AREA : SHOTS_TOPIC) turns.push({ role: 'user', content: `Item: "${it}"\n${ask}` }, { role: 'assistant', content: a });
  turns.push({ role: 'user', content: `Item: "${item.slice(0, 300)}"\n${ask}` });
  return turns;
}

/** Keeps an answer only if it could be a folder name: not the parent, not an existing folder, not instruction words. */
export function cleanName(answer: string, avoid: string[]): string[] | null {
  const parts = answer
    .split('›')
    .map((p) => p.replace(/\s+/g, ' ').replace(/^[\s"'.,:;-]+|[\s"'.,:;-]+$/g, ''))
    .filter(Boolean);
  if (!parts.length || parts.some((p) => /\b(area|subject|folder|item)\b/i.test(p))) return null;
  const taken = new Set(avoid.map((a) => a.toLowerCase()));
  if (taken.has(parts[parts.length - 1].toLowerCase())) return null;
  return parts;
}

let model: Promise<Wllama> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

function load(onProgress?: (pct: number) => void): Promise<Wllama> {
  model ??= (async () => {
    const { Wllama } = await import('@wllama/wllama');
    const abs = (u: string) => new URL(u, location.href).href;
    const w = new Wllama({ default: abs(NAMER_MODEL.wasm) }, { suppressNativeLog: true });
    // Browsers that need wllama's compat build get it from Stacks, not from a CDN.
    w.setCompat({ worker: abs(NAMER_MODEL.compat.worker), wasm: abs(NAMER_MODEL.compat.wasm) });
    // 4 threads was fastest in the assessment; more made it slower.
    const threads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
    await w.loadModelFromUrl(new URL(NAMER_MODEL.url, location.href).href, {
      n_ctx: 1024,
      n_gpu_layers: 0,
      n_threads: threads,
      progressCallback: ({ loaded, total }) => onProgress?.(total ? Math.round((100 * loaded) / total) : 0),
    });
    return w;
  })().catch((err) => {
    model = null;
    throw err;
  });
  return model;
}

/** Frees the model's memory after a while without use. The download stays cached in the browser. */
function scheduleUnload() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    const m = model;
    model = null;
    void m?.then((w) => w.exit()).catch(() => {});
  }, NAMER_IDLE_MS);
}

/**
 * A folder name for an item: inside `parent` (["Robotics"]) when given, otherwise a 2-level path
 * ("Area › Subject"). Returns the folder names, or null when the model's answer isn't usable.
 */
export async function suggestFolderName(item: string, parent: string[] | null, avoid: string[], onProgress?: (pct: number) => void): Promise<string[] | null> {
  clearTimeout(idle);
  try {
    const w = await load(onProgress);
    const r = await w.createChatCompletion({
      messages: namingMessages(item, !parent),
      max_tokens: 16,
      temperature: 0,
      grammar: parent ? NAME_GRAMMAR : PATH_GRAMMAR,
      chat_template_kwargs: { enable_thinking: false },
    });
    const names = cleanName(r.choices[0]?.message?.content ?? '', [...avoid, ...(parent ?? [])]);
    if (!names) return null;
    return parent ? [...parent, names[names.length - 1]] : names.slice(0, 2);
  } finally {
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
  const m = model;
  model = null;
  await m?.then((w) => w.exit()).catch(() => {});
  const { CacheManager } = await import('@wllama/wllama');
  await new CacheManager().delete(new URL(NAMER_MODEL.url, location.href).href);
}
