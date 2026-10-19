import { FetchError, safeFetch } from './net.js';

export interface Preview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  author: string;
  image: string | null;
  /** Seconds, when the page or oEmbed says. */
  duration: number | null;
  kind: 'link' | 'video';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}
function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

const clean = (s: string | undefined, max = 400) => decodeEntities((s ?? '').replace(/\s+/g, ' ').trim()).slice(0, max);

/** Reads <meta> tags in any attribute order. Keys are lower-cased property/name values. */
export function readMeta(html: string): Map<string, string> {
  const head = html.slice(0, 400_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    const key = attr('property') ?? attr('name') ?? attr('itemprop');
    const content = attr('content');
    if (!key || !content) continue;
    const k = (key[1] ?? key[2] ?? key[3]).toLowerCase();
    if (!meta.has(k)) meta.set(k, content[1] ?? content[2] ?? content[3]);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (title) meta.set('<title>', title[1]);
  return meta;
}

function isoDurationToSeconds(v: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(v.trim());
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0) || null;
}

function absolute(src: string | undefined, base: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(decodeEntities(src.trim()), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, '');

function isYouTube(u: URL) {
  const h = u.hostname.replace(/^(www|m)\./, '');
  return h === 'youtu.be' || h === 'youtube.com' || h === 'music.youtube.com';
}
const isVimeo = (u: URL) => u.hostname.replace(/^www\./, '') === 'vimeo.com';

async function fromOEmbed(endpoint: string, original: string, siteName: string): Promise<Preview | null> {
  const res = await safeFetch(`${endpoint}${encodeURIComponent(original)}`, 'application/json');
  if (res.status !== 200) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : '');
  return {
    url: original,
    title: clean(str('title'), 200),
    description: clean(str('description'), 400),
    siteName,
    author: clean(str('author_name'), 120),
    image: absolute(str('thumbnail_url'), original),
    duration: typeof data.duration === 'number' ? data.duration : null,
    kind: 'video',
  };
}

export function previewFromHtml(html: string, pageUrl: string): Preview {
  const meta = readMeta(html);
  const get = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.trim());
  const ogType = (get('og:type') ?? '').toLowerCase();
  const durationRaw = get('og:video:duration', 'video:duration', 'duration');
  let duration: number | null = null;
  if (durationRaw) duration = /^\d+$/.test(durationRaw) ? Number(durationRaw) : isoDurationToSeconds(durationRaw);
  return {
    url: pageUrl,
    title: clean(get('og:title', 'twitter:title', '<title>'), 200),
    description: clean(get('og:description', 'twitter:description', 'description'), 400),
    siteName: clean(get('og:site_name', 'application-name'), 80) || hostOf(pageUrl),
    author: clean(get('author', 'article:author', 'twitter:creator'), 120),
    image: absolute(get('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), pageUrl),
    duration,
    kind: ogType.startsWith('video') ? 'video' : 'link',
  };
}

export async function getPreview(raw: string): Promise<Preview> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError(400, 'That does not look like a web address.');
  }
  if (isYouTube(u)) {
    const p = await fromOEmbed('https://www.youtube.com/oembed?format=json&url=', raw, 'YouTube');
    if (p) return p;
  }
  if (isVimeo(u)) {
    const p = await fromOEmbed('https://vimeo.com/api/oembed.json?url=', raw, 'Vimeo');
    if (p) return p;
  }
  const res = await safeFetch(raw);
  if (res.status >= 400) throw new FetchError(502, `The site answered with an error (${res.status}).`);
  if (!/html|xml/i.test(res.contentType)) {
    const file = decodeURIComponent(new URL(res.finalUrl).pathname.split('/').pop() ?? '') || hostOf(res.finalUrl);
    return { url: raw, title: file, description: res.contentType.split(';')[0], siteName: hostOf(res.finalUrl), author: '', image: null, duration: null, kind: 'link' };
  }
  const p = previewFromHtml(res.body, res.finalUrl);
  return { ...p, url: raw };
}
