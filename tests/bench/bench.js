// Runs one benchmark job in the browser and posts the raw results back to run_bench.py.
// Jobs: ?job=<embed id> (folder choice, new-folder detection, joins, speed),
//       ?job=gen:<gen id> (naming new folders), ?job=score-names, ?job=blank. Add &warm=1 to only download.
import { env, pipeline, AutoTokenizer, AutoModel } from './vendor/transformers.min.js';
import { Wllama } from './vendor/wllama/index.js';

env.backends.onnx.wasm.wasmPaths = new URL('./vendor/ort/', location.href).href;
env.allowLocalModels = false;

const q = new URLSearchParams(location.search);
const jobId = q.get('job');
const warm = q.get('warm') === '1';
const status = (s) => {
  document.getElementById('status').textContent = s;
  void fetch('/api/log', { method: 'POST', body: `[${jobId}] ${s}` });
};
const post = (body) => fetch(`/api/result?job=${encodeURIComponent(jobId)}${warm ? '&warm=1' : ''}`, { method: 'POST', body: JSON.stringify(body) });
const now = () => performance.now();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---------- vectors ----------
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const normalize = (v) => {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
};
const mean = (vs) => {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length;
  return normalize(out);
};

// ---------- embedders: each returns embed(texts) -> normalized Float32Array[] ----------
async function transformersEmbedder(cfg) {
  const extractor = await pipeline('feature-extraction', cfg.repo, { dtype: cfg.dtype, device: 'wasm' });
  return async (texts) => {
    const out = [];
    for (let i = 0; i < texts.length; i += 8) {
      const batch = texts.slice(i, i + 8).map((t) => (cfg.prefix ?? '') + t);
      const t = await extractor(batch, { pooling: cfg.pooling, normalize: true });
      const [n, d] = t.dims;
      for (let k = 0; k < n; k++) out.push(Float32Array.from(t.data.subarray(k * d, (k + 1) * d)));
    }
    return out;
  };
}

async function gemmaEmbedder(cfg) {
  const tokenizer = await AutoTokenizer.from_pretrained(cfg.repo);
  const model = await AutoModel.from_pretrained(cfg.repo, { dtype: cfg.dtype, device: 'wasm', ...(cfg.modelFile ? { model_file_name: cfg.modelFile } : {}) });
  return async (texts) => {
    const out = [];
    for (let i = 0; i < texts.length; i += 8) {
      const inputs = await tokenizer(texts.slice(i, i + 8).map((t) => cfg.prefix + t), { padding: true, truncation: true });
      const { sentence_embedding: e } = await model(inputs);
      const [n, d] = e.dims;
      for (let k = 0; k < n; k++) out.push(normalize(Float32Array.from(e.data.subarray(k * d, (k + 1) * d))));
    }
    return out;
  };
}

/** Model2Vec: a lookup table of token vectors, averaged. No neural network and no ONNX runtime. */
async function potionEmbedder(cfg) {
  const tokenizer = await AutoTokenizer.from_pretrained(cfg.repo);
  const url = `https://huggingface.co/${cfg.repo}/resolve/main/model.safetensors`;
  const cache = await caches.open('potion-cache');
  let res = await cache.match(url);
  if (!res) {
    await cache.add(url);
    res = await cache.match(url);
  }
  const buf = await res.arrayBuffer();
  const headerLen = Number(new DataView(buf).getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
  const key = Object.keys(header).find((k) => k !== '__metadata__');
  const { shape, data_offsets: [start], dtype } = header[key];
  if (dtype !== 'F32') throw new Error(`potion dtype ${dtype} not handled`);
  const [, dim] = shape;
  const table = new Float32Array(buf, 8 + headerLen + start, shape[0] * dim);
  return async (texts) =>
    texts.map((t) => {
      const ids = tokenizer.encode(t, { add_special_tokens: false });
      const v = new Float32Array(dim);
      for (const id of ids) for (let k = 0; k < dim; k++) v[k] += table[id * dim + k];
      return normalize(v);
    });
}

/** Baseline: TF-IDF word overlap over the library's own words. */
function tfidfEmbedder(corpus) {
  const STOP = new Set('a an and are as at be by for from how in into is it of on or the to vs with your you what why its this that'.split(' '));
  const words = (t) => t.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 1 && !STOP.has(w)) ?? [];
  const df = new Map();
  for (const t of corpus) for (const w of new Set(words(t))) df.set(w, (df.get(w) ?? 0) + 1);
  const vocab = [...df.keys()];
  const index = new Map(vocab.map((w, i) => [w, i]));
  return async (texts) =>
    texts.map((t) => {
      const v = new Float32Array(vocab.length);
      for (const w of words(t)) if (index.has(w)) v[index.get(w)] += Math.log(1 + corpus.length / df.get(w));
      return normalize(v);
    });
}

// ---------- data ----------
const itemText = (title, notes) => (notes ? `${title}. ${notes}` : title).slice(0, 600);
const pathText = (p) => p.replace(/ › /g, ' / ');
const parentOf = (p) => p.split(' › ')[0];

async function loadData() {
  const syn = await (await fetch('../data/synthetic.json')).json();
  const exp = await (await fetch('../stacks-2026-11-14.json')).json();
  const byId = new Map(exp.topics.map((t) => [t.id, t]));
  const pathOf = (t) => (t ? [...(t.parentId ? [pathOf(byId.get(t.parentId))] : []), t.name].join(' › ') : '');
  const real = {
    items: exp.items.map((it, i) => ({ id: `r${i}`, folder: pathOf(byId.get(it.topicId)), title: it.title, notes: (it.description ?? '').replace(/\s+/g, ' ').slice(0, 300), addedAt: it.addedAt })),
    folders: exp.topics.map((t) => pathOf(t)),
  };
  return { syn, real };
}

// ---------- evaluation (the same for every embedder) ----------
const LATEST = 5;

/** A folder as the app would describe it: its path plus its latest 5 items (minus excluded ones). */
function folderVectors(folder, items, vec, pathVec, exclude) {
  const latest = items.filter((i) => i.folder === folder && !exclude.has(i.id)).sort((a, b) => b.addedAt - a.addedAt).slice(0, LATEST);
  return [pathVec.get(folder), ...latest.map((i) => vec.get(i.id))];
}
function scoreFolder(qv, vs) {
  const max = Math.max(...vs.map((v) => dot(qv, v)));
  const centroid = dot(qv, mean(vs));
  return { max, centroid, hybrid: 0.5 * max + 0.5 * centroid };
}
function rank(qv, folders, items, vec, pathVec, exclude, how = q.get('how') ?? 'hybrid') {
  return folders.map((f) => ({ f, s: scoreFolder(qv, folderVectors(f, items, vec, pathVec, exclude)) })).sort((a, b) => b.s[how] - a.s[how]);
}

async function evaluate(embed, { syn, real }) {
  const out = {};
  // Index everything once (timed: this is the "prepare your saved items" cost).
  let t0 = now();
  const synVecs = await embed(syn.items.map((i) => itemText(i.title, i.notes)));
  out.indexMsPerItem = (now() - t0) / syn.items.length;
  const vec = new Map(syn.items.map((i, k) => [i.id, synVecs[k]]));
  const pathVec = new Map(syn.folders.map((f, k) => [f, null]));
  (await embed(syn.folders.map(pathText))).forEach((v, k) => pathVec.set(syn.folders[k], v));

  // 1) Folder choice, leave one out.
  const strategies = { max: 0, centroid: 0, hybrid: 0 };
  out.choice = syn.items.map((it) => {
    const ex = new Set([it.id]);
    const qv = vec.get(it.id);
    for (const how of Object.keys(strategies)) if (rank(qv, syn.folders, syn.items, vec, pathVec, ex, how)[0].f === it.folder) strategies[how]++;
    const r = rank(qv, syn.folders, syn.items, vec, pathVec, ex);
    const pos = r.findIndex((x) => x.f === it.folder);
    return { id: it.id, title: it.title, folder: it.folder, pick: r[0].f, top3: r.slice(0, 3).map((x) => x.f), rank: pos + 1, top: r[0].s[q.get('how') ?? 'hybrid'], second: r[1].s[q.get('how') ?? 'hybrid'] };
  });
  out.strategyTop1 = Object.fromEntries(Object.entries(strategies).map(([k, v]) => [k, v / syn.items.length]));

  // 2) New-folder detection: hide a whole folder; its items should score low everywhere.
  out.novel = [];
  for (const hidden of syn.folders) {
    const others = syn.folders.filter((f) => f !== hidden);
    const ex = new Set(syn.items.filter((i) => i.folder === hidden).map((i) => i.id));
    const parentKnown = others.some((f) => parentOf(f) === parentOf(hidden));
    for (const it of syn.items.filter((i) => i.folder === hidden)) {
      const r = rank(vec.get(it.id), others, syn.items, vec, pathVec, ex);
      out.novel.push({ id: it.id, title: it.title, folder: hidden, top: r[0].s[q.get('how') ?? 'hybrid'], pick: r[0].f, predParent: parentOf(r[0].f), parentKnown });
    }
  }

  // 3) Joining: each new paste against the latest 5 items of every folder.
  const shown = syn.folders.flatMap((f) => syn.items.filter((i) => i.folder === f).sort((a, b) => b.addedAt - a.addedAt).slice(0, LATEST));
  const joinVecs = await embed(syn.joins.map((j) => itemText(j.title, j.notes)));
  out.joins = syn.joins.map((j, k) => ({
    title: j.title,
    join: j.join,
    candidates: shown.map((c) => ({ title: c.title, sim: dot(joinVecs[k], vec.get(c.id)) })).sort((a, b) => b.sim - a.sim).slice(0, 10),
    targetShown: !j.join || shown.some((c) => c.title === j.join),
  }));

  // 4) The real export, leave one out (too small to score, shown for a look).
  const rv = await embed(real.items.map((i) => itemText(i.title, i.notes)));
  const rvec = new Map(real.items.map((i, k) => [i.id, rv[k]]));
  const rpath = new Map();
  (await embed(real.folders.map(pathText))).forEach((v, k) => rpath.set(real.folders[k], v));
  const rFolders = real.folders.filter((f) => f.includes(' › ') || real.items.some((i) => i.folder === f));
  out.real = real.items.map((it) => {
    const r = rank(rvec.get(it.id), rFolders, real.items, rvec, rpath, new Set([it.id]));
    return { title: it.title, folder: it.folder, ranking: r.map((x) => [x.f, +x.s.hybrid.toFixed(3)]) };
  });

  // 5) Speed for one paste of about 100 words.
  const paste = real.items.map((i) => itemText(i.title, i.notes)).sort((a, b) => b.length - a.length)[0];
  const times = [];
  for (let i = 0; i < 12; i++) {
    t0 = now();
    await embed([paste]);
    times.push(now() - t0);
  }
  out.pasteMs = median(times.slice(2));
  out.pasteWords = paste.split(/\s+/).length;
  return out;
}

// ---------- naming new folders ----------
function namingCases({ syn, real }) {
  const cases = [];
  const add = (set, folders, items, hidden) => {
    const others = folders.filter((f) => f !== hidden && items.some((i) => i.folder === f || f.includes(' › ')));
    const parent = hidden.includes(' › ') ? parentOf(hidden) : null;
    const siblings = parent ? others.filter((f) => parentOf(f) === parent && f.includes(' › ')).map((f) => f.split(' › ')[1]) : [];
    const first = items.filter((i) => i.folder === hidden).sort((a, b) => a.addedAt - b.addedAt)[0];
    if (!first) return;
    const newArea = !parent || !siblings.length;
    const tops = [...new Set(others.map(parentOf))].filter((t) => !newArea || t !== parent);
    cases.push({ set, truth: hidden, parent: newArea ? null : parent, siblings, tops, title: first.title, notes: first.notes.slice(0, 200) });
  };
  for (const f of syn.folders) add('synthetic', syn.folders, syn.items, f);
  for (const f of real.folders) add('real', real.folders, real.items, f);
  return cases;
}

const WORD = String.raw`[A-Z0-9&] [A-Za-z0-9&+.'-]{0,19}`;
const NAME_GRAMMAR = `root ::= word (" " word)? (" " word)?\nword ::= ${WORD}\n`;
const PATH_GRAMMAR = `root ::= name " › " name\nname ::= word (" " word)? (" " word)?\nword ::= ${WORD}\n`;

/** Prompt v2: worked examples as chat turns (works better for small models). Areas not in the test set. */
const SHOTS_SUB = [
  ['Gardening', 'Houseplants, Composting', 'How to prune tomato plants for bigger harvests', 'Vegetables'],
  ['Music', 'Piano, Music Theory', 'Learn barre chords on guitar in 10 minutes', 'Guitar'],
  ['Home', 'Cleaning, Furniture', 'Fixing a leaking kitchen faucet', 'Plumbing'],
];
const SHOTS_AREA = [
  ['Gardening, Music', "Beginner's guide to film photography", 'Photography › Film Cameras'],
  ['Home, Music', 'How to learn Spanish vocabulary fast', 'Languages › Spanish'],
];
function namingMessagesV2(c) {
  const item = c.notes ? `${c.title} — ${c.notes}` : c.title;
  const turns = [];
  if (c.parent) {
    const ask = (parent, subs, it) => `Parent folder: ${parent}\nExisting subfolders: ${subs}\nNew item: "${it}"\nName a new subfolder for this item (a general subject, 1-3 words).`;
    for (const [p, subs, it, a] of SHOTS_SUB) turns.push({ role: 'user', content: ask(p, subs, it) }, { role: 'assistant', content: a });
    turns.push({ role: 'user', content: ask(c.parent, c.siblings.join(', '), item) });
  } else {
    const ask = (tops, it) => `Existing top-level folders: ${tops}\nNew item: "${it}"\nNone fit. Name a new folder path: Area › Subject.`;
    for (const [tops, it, a] of SHOTS_AREA) turns.push({ role: 'user', content: ask(tops, it) }, { role: 'assistant', content: a });
    turns.push({ role: 'user', content: ask(c.tops.join(', '), item) });
  }
  return turns;
}

/** Prompt v3: ask what the item is about (easier for small models); same example areas as v2. */
const SHOTS_TOPIC = [
  ['How to prune tomato plants for bigger harvests', 'Vegetables'],
  ['Learn barre chords on guitar in 10 minutes', 'Guitar'],
  ['Fixing a leaking kitchen faucet', 'Plumbing'],
  ['Watercolor techniques for beginners', 'Painting'],
];
function namingMessagesV3(c) {
  const item = c.notes ? `${c.title} — ${c.notes}` : c.title;
  const turns = [{ role: 'system', content: 'Say what subject an item is about, in 1 to 3 words, like a library shelf label.' }];
  if (c.parent) {
    for (const [it, a] of SHOTS_TOPIC) turns.push({ role: 'user', content: `Item: "${it}"\nSubject:` }, { role: 'assistant', content: a });
    turns.push({ role: 'user', content: `Item: "${item}"\nSubject:` });
  } else {
    for (const [tops, it, a] of SHOTS_AREA) turns.push({ role: 'user', content: `Item: "${it}"\nArea › Subject:` }, { role: 'assistant', content: a });
    turns.push({ role: 'user', content: `Item: "${item}"\nArea › Subject:` });
  }
  return turns;
}

function namingMessages(c) {
  const item = `"${c.title}${c.notes ? ` — ${c.notes}` : ''}"`;
  const user = c.parent
    ? `The folder "${c.parent}" contains these subfolders: ${c.siblings.join(', ')}.\nA new item does not fit any of them:\n${item}\nName a new subfolder of "${c.parent}" for it: a general subject of 1 to 3 words in Title Case that similar items would also fit. Do not repeat the item's title.\nExamples of good names: Grippers, Diffusion Models, Pizza, Investing, Trail Running.`
    : `None of the existing folders fit this new item:\n${item}\nExisting top-level folders: ${c.tops.join(', ')}.\nMake a new folder path with 2 levels, "Area › Subject": a broad area, then a general subject of 1 to 3 words, both in Title Case.\nExamples: Cooking › Pizza, Finance › Investing, Robotics › Grippers.`;
  return [
    { role: 'system', content: 'You name folders in a personal library of links and notes. Answer with the folder name only.' },
    { role: 'user', content: user },
  ];
}

async function runGen(cfg, data) {
  const w = new Wllama({ default: new URL('./vendor/wllama/wllama.wasm', location.href).href }, { suppressNativeLog: true });
  let t0 = now();
  status(`loading ${cfg.file}`);
  const threads = q.get('threads') ? Number(q.get('threads')) : undefined;
  await w.loadModelFromHF({ repo: q.get('repo') ?? cfg.repo, file: q.get('file') ?? cfg.file }, { n_ctx: 1024, n_gpu_layers: 0, ...(threads ? { n_threads: threads } : {}), progressCallback: ({ loaded, total }) => status(`download ${Math.round((100 * loaded) / total)}%`) });
  const loadMs = now() - t0;
  if (warm) return { loadMs, threads: w.getNumThreads() };
  const prompt = q.get('prompt') ?? 'v2';
  const useGrammar = q.get('grammar') !== '0';
  const cases = namingCases(data).slice(0, Number(q.get('limit') ?? 999));
  const results = [];
  for (const [i, c] of cases.entries()) {
    status(`naming ${i + 1}/${cases.length}`);
    t0 = now();
    let answer = '';
    let error = null;
    try {
      const r = await w.createChatCompletion({
        messages: { v1: namingMessages, v2: namingMessagesV2, v3: namingMessagesV3 }[prompt](c),
        max_tokens: 16,
        temperature: 0,
        ...(useGrammar ? { grammar: c.parent ? NAME_GRAMMAR : PATH_GRAMMAR } : {}),
        ...(cfg.templateKwargs ? { chat_template_kwargs: cfg.templateKwargs } : {}),
      });
      answer = (r.choices[0].message.content ?? '').trim();
      results.push({ ...c, answer, ms: now() - t0, promptTokens: r.usage?.prompt_tokens ?? null, completionTokens: r.usage?.completion_tokens ?? null, timings: r.timings ?? null });
    } catch (e) {
      error = String(e?.message ?? e);
      results.push({ ...c, answer, error, ms: now() - t0 });
    }
  }
  const usedThreads = w.getNumThreads();
  await w.exit();
  return { loadMs, threads: usedThreads, prompt, grammar: useGrammar, results };
}

/** The same naming test on the ONNX runtime (Transformers.js), greedy, no grammar. */
async function runGenOnnx(cfg, data) {
  let t0 = now();
  status(`loading ${cfg.repo}`);
  const generator = await pipeline('text-generation', cfg.repo, { dtype: cfg.dtype, device: 'wasm' });
  const loadMs = now() - t0;
  if (warm) return { loadMs };
  const prompt = q.get('prompt') ?? 'v2';
  const cases = namingCases(data).slice(0, Number(q.get('limit') ?? 999));
  const results = [];
  for (const [i, c] of cases.entries()) {
    status(`naming ${i + 1}/${cases.length}`);
    t0 = now();
    try {
      const messages = { v1: namingMessages, v2: namingMessagesV2, v3: namingMessagesV3 }[prompt](c);
      const out = await generator(messages, { max_new_tokens: 12, do_sample: false, ...(cfg.templateKwargs ? { tokenizer_encode_kwargs: cfg.templateKwargs } : {}) });
      const text = out[0].generated_text.at(-1).content ?? '';
      // Keep the first line, without quotes or a trailing full stop.
      const answer = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim().split('\n')[0].replace(/^["'*\s]+|["'*.\s]+$/g, '');
      results.push({ ...c, answer, raw: text, ms: now() - t0 });
    } catch (e) {
      results.push({ ...c, answer: '', error: String(e?.message ?? e), ms: now() - t0 });
    }
  }
  return { loadMs, prompt, results };
}

// ---------- the app's folder proposals: speed with and without the pre-read, GPU vs CPU ----------
// Same prompt, grammar and settings as src/local/namer.ts (copied, since this page is plain JS).
const APP_SHOTS = [
  ['Music, Home', 'How to prune tomato plants for bigger harvests', 'Gardening › Vegetables'],
  ['Gardening, Music', 'Learn barre chords on guitar in 10 minutes', 'Music › Guitar'],
  ['Music, Gardening, Home', 'Fixing a leaking kitchen faucet', 'Home › Plumbing'],
  ['Music, Home', "Beginner's guide to film photography", 'Photography › Film Cameras'],
];
function appFolderMessages(item, areas) {
  const ask = (a, it) => `Existing areas: ${a || 'none'}\nItem: "${it}"\nFolder (Area › Subfolder):`;
  const turns = [{ role: 'system', content: 'File each item in a folder: a broad area, then a subject of 1 to 3 words, like library shelves. Reuse an existing area when it fits.' }];
  for (const [a, it, ans] of APP_SHOTS) turns.push({ role: 'user', content: ask(a, it) }, { role: 'assistant', content: ans });
  turns.push({ role: 'user', content: ask(areas.join(', '), item) });
  return turns;
}
/** Variant without your areas in the prompt: same 4 examples, all as plain "Item → Area › Subfolder". */
function appFolderMessagesNoAreas(item) {
  const ask = (it) => `Item: "${it}"\nFolder (Area › Subfolder):`;
  const turns = [{ role: 'system', content: 'File each item in a folder: a broad area, then a subject of 1 to 3 words, like library shelves.' }];
  for (const [, it, ans] of APP_SHOTS) turns.push({ role: 'user', content: ask(it) }, { role: 'assistant', content: ans });
  turns.push({ role: 'user', content: ask(item) });
  return turns;
}
const APP_GRAMMAR = `root ::= name " › " name\nname ::= word (" " word)? (" " word)?\nword ::= ${WORD} | "&"\n`;

async function runNamerSpeed() {
  const device = q.get('device') ?? 'cpu';
  const gpu = !!(navigator.gpu && (await Promise.race([navigator.gpu.requestAdapter().catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))])));
  if (device === 'gpu' && !gpu) return { device, gpuAvailable: false };
  const areas = ['Robotics', 'Cooking', 'Machine Learning'];
  const items = ['Hiking the Kumano Kodo trail in Japan', 'Index funds vs ETFs explained', 'Learning to play the violin as an adult'];
  const url = new URL('./vendor/qwen3-0.6b.gguf', location.href).href;
  const threads = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const load = async () => {
    const w = new Wllama({ default: new URL('./vendor/wllama/wllama.wasm', location.href).href }, { suppressNativeLog: true });
    const t0 = now();
    await w.loadModelFromUrl(url, { n_ctx: 1024, n_gpu_layers: device === 'gpu' ? 99 : 0, n_threads: threads });
    return { w, ms: now() - t0 };
  };
  const ask = async (w, item) => {
    const t0 = now();
    const r = await w.createChatCompletion({ messages: appFolderMessages(item, areas), max_tokens: 16, temperature: 0, grammar: APP_GRAMMAR, chat_template_kwargs: { enable_thinking: false } });
    return { item, answer: r.choices[0].message.content, ms: now() - t0, read: r.timings?.prompt_n, reused: r.timings?.cache_n, readPerSec: r.timings?.prompt_per_second };
  };
  // A: as before (no pre-read): load, then the first proposal reads the whole prompt.
  status(`${device}: without pre-read`);
  let { w, ms: loadA } = await load();
  const noPre = await ask(w, items[0]);
  await w.exit();
  // B: as now: load, pre-read the fixed part, then three proposals.
  status(`${device}: with pre-read`);
  ({ w } = await load());
  let t0 = now();
  await w.createChatCompletion({ messages: appFolderMessages('', []), max_tokens: 1, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
  const preReadMs = now() - t0;
  const withPre = [];
  for (const it of items) withPre.push(await ask(w, it));
  await w.exit();
  return { device, gpuAvailable: gpu, threads, loadMs: loadA, noPreRead: noPre, preReadMs, withPreRead: withPre };
}

/** Both prompts over the 20 hidden-folder cases, each with the pre-read (grammar included). */
async function runNamerQuality(data) {
  const w = new Wllama({ default: new URL('./vendor/wllama/wllama.wasm', location.href).href }, { suppressNativeLog: true });
  await w.loadModelFromUrl(new URL('./vendor/qwen3-0.6b.gguf', location.href).href, { n_ctx: 1024, n_gpu_layers: 0, n_threads: 4 });
  const cases = namingCases(data);
  const out = {};
  for (const variant of ['areas', 'noAreas']) {
    const build = (c) => (variant === 'areas' ? appFolderMessages(c.notes ? `${c.title}. ${c.notes}` : c.title, c.tops) : appFolderMessagesNoAreas(c.notes ? `${c.title}. ${c.notes}` : c.title));
    let t0 = now();
    await w.createChatCompletion({ messages: build({ title: '', notes: '', tops: [] }), max_tokens: 1, temperature: 0, grammar: APP_GRAMMAR, chat_template_kwargs: { enable_thinking: false } });
    const preReadMs = now() - t0;
    const rows = [];
    for (const [i, c] of cases.entries()) {
      status(`${variant} ${i + 1}/${cases.length}`);
      t0 = now();
      const r = await w.createChatCompletion({ messages: build(c), max_tokens: 16, temperature: 0, grammar: APP_GRAMMAR, chat_template_kwargs: { enable_thinking: false } });
      rows.push({ truth: c.truth, tops: c.tops, title: c.title, answer: r.choices[0].message.content, ms: now() - t0, read: r.timings?.prompt_n });
    }
    out[variant] = { preReadMs, rows };
  }
  await w.exit();
  return out;
}

// ---------- main ----------
(async () => {
  try {
    const jobs = await (await fetch('./jobs.json')).json();
    const data = await loadData();
    const meta = { cores: navigator.hardwareConcurrency, isolated: self.crossOriginIsolated, ua: navigator.userAgent };
    if (jobId === 'blank') return void (await post({ meta }));

    if (jobId.startsWith('gen:')) {
      const cfg = jobs.gen.find((g) => g.id === jobId.slice(4));
      return void (await post({ meta, ...(await runGen(cfg, data)) }));
    }

    if (jobId === 'namer-quality') return void (await post({ meta, ...(await runNamerQuality(data)) }));
    if (jobId === 'namer-speed') return void (await post({ meta, ...(await runNamerSpeed()) }));

    if (jobId.startsWith('onnxgen:')) {
      const cfg = jobs.genOnnx.find((g) => g.id === jobId.slice(8));
      return void (await post({ meta, ...(await runGenOnnx(cfg, data)) }));
    }

    if (jobId === 'score-names') {
      // Compare each suggested name with the real folder name, by meaning (bge-small) and exactly.
      const embed = await transformersEmbedder(jobs.embed.find((e) => e.id === jobs.nameScorer));
      const scored = {};
      for (const key of jobs.gen.flatMap((g) => ['v1', 'v2', 'v3'].map((v) => `${g.id}-${v}`))) {
        const raw = await fetch(`/api/raw/gen-${key}.json`);
        if (!raw.ok) continue;
        const { results = [] } = await raw.json();
        const leaf = (s) => s.split(' › ').pop() ?? '';
        const a = await embed(results.map((r) => leaf(r.answer) || '-'));
        const b = await embed(results.map((r) => leaf(r.truth)));
        scored[key] = results.map((r, k) => ({ truth: r.truth, answer: r.answer, sim: dot(a[k], b[k]) }));
      }
      return void (await post({ meta, scored }));
    }

    const cfg = jobs.embed.find((e) => e.id === jobId);
    status('loading model');
    const t0 = now();
    const corpus = [...data.syn.items, ...data.real.items].map((i) => itemText(i.title, i.notes));
    const embed =
      cfg.kind === 'tfidf' ? tfidfEmbedder(corpus) : cfg.kind === 'potion' ? await potionEmbedder(cfg) : cfg.kind === 'gemma' ? await gemmaEmbedder(cfg) : await transformersEmbedder(cfg);
    await embed(['warm up']);
    const loadMs = now() - t0;
    if (warm) return void (await post({ meta, loadMs }));
    status('evaluating');
    const result = await evaluate(embed, data);
    await post({ meta, loadMs, ...result });
  } catch (e) {
    await post({ error: String(e?.stack ?? e) });
  } finally {
    document.getElementById('status').textContent = 'done';
  }
})();
