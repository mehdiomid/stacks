// Puts the local-mode model files in ./models, so the Stacks server can serve them at /models/.
// Runs during the Docker build (and with `npm run models` for development). Files are pinned to a
// Hugging Face commit and checked against their SHA-256; files already present and correct are kept.
//
//   node scripts/fetch-models.mjs            embedding model and runtimes (~50 MB)
//   node scripts/fetch-models.mjs --namer    also the Qwen naming model (~400 MB)
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(process.cwd(), 'models');

const EMBED = 'Snowflake/snowflake-arctic-embed-xs';
const EMBED_REV = 'd8c86521100d3556476a063fc2342036d45c106f';
const NAMER = 'unsloth/Qwen3-0.6B-GGUF';
const NAMER_REV = '50968a4468ef4233ed78cd7c3de230dd1d61a56b';

const FILES = [
  { repo: EMBED, rev: EMBED_REV, file: 'config.json', sha: 'd7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec' },
  { repo: EMBED, rev: EMBED_REV, file: 'tokenizer.json', sha: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854' },
  { repo: EMBED, rev: EMBED_REV, file: 'tokenizer_config.json', sha: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810' },
  { repo: EMBED, rev: EMBED_REV, file: 'special_tokens_map.json', sha: '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a' },
  { repo: EMBED, rev: EMBED_REV, file: 'onnx/model_quantized.onnx', sha: 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1' },
];
const NAMER_FILES = [
  { repo: NAMER, rev: NAMER_REV, file: 'Qwen3-0.6B-Q4_K_M.gguf', sha: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a' },
];

/**
 * wllama's runtimes come with its npm packages: the main build, and the "compat" build for browsers
 * without JSPI or Memory64 (Safari, Firefox, older Chrome). The ONNX runtime is bundled by Vite.
 */
const FROM_NODE_MODULES = [
  ['node_modules/@wllama/wllama/esm/wasm/wllama.wasm', 'wllama/wllama.wasm'],
  ['node_modules/@wllama/wllama-compat/wasm/wllama.js', 'wllama/compat/wllama.js'],
  ['node_modules/@wllama/wllama-compat/wasm/wllama.wasm', 'wllama/compat/wllama.wasm'],
];

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function fetchOne({ repo, rev, file, sha }) {
  const dest = join(ROOT, repo, file);
  if (existsSync(dest) && (await sha256(dest)) === sha) return console.log(`ok       ${repo}/${file}`);
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
  console.log(`download ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const got = await sha256(dest);
  if (got !== sha) throw new Error(`${repo}/${file}: checksum ${got} does not match ${sha}`);
}

for (const f of [...FILES, ...(process.argv.includes('--namer') ? NAMER_FILES : [])]) await fetchOne(f);
for (const [from, to] of FROM_NODE_MODULES) {
  if (!existsSync(from)) throw new Error(`${from} is missing: run npm ci first`);
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  copyFileSync(from, join(ROOT, to));
  console.log(`copied   ${to}`);
}
