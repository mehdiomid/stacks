import { displayName, MAX_DEPTH, splitPathName } from './tree';

export const LIMITS = { maxLinks: 100, maxLines: 300, maxChars: 20_000 };

export interface ParsedLine {
  /** 1-based number, counting only non-empty lines. */
  n: number;
  /** The line as typed, minus list bullets and folder paths. */
  raw: string;
  /** The line as typed, minus list bullets (folder paths kept). */
  source: string;
  /** The line with its links taken out. */
  text: string;
  urls: string[];
  /** A blank line came before this one (a paragraph break). */
  blankBefore: boolean;
  /** Folder written on this line itself (`https://… \robotics`): applies to its item only. */
  folder?: string[];
  /** Folder from the last path written on a line of its own above this one. */
  section?: string[];
}

/*
 * Folder paths: \robotics, \robotics\papers, \machine-learning, \"Machine Learning"\papers.
 * A path starts at the beginning of a line or after a space, so URLs and Windows paths (C:\x) are left alone.
 */
const SEGMENT = String.raw`(?:"[^"\n\\]+"|“[^”\n\\]+”|[^\s\\"“”]+)`;
const PATH_RE = new RegExp(String.raw`(?<=^|\s)(?:\\${SEGMENT})+`, 'g');
const SEGMENT_RE = new RegExp(String.raw`\\(${SEGMENT})`, 'g');

export interface FolderPath {
  names: string[];
  /** The path had more than MAX_DEPTH levels; the extra ones were dropped. */
  clipped: boolean;
}

/** Reads one typed path (`\robotics\papers`) into folder names. */
export function readPath(token: string): FolderPath {
  const names: string[] = [];
  for (const m of token.matchAll(SEGMENT_RE)) {
    const seg = m[1];
    const quoted = /^["“]/.test(seg);
    const name = quoted ? displayName(seg.slice(1, -1), true) : displayName(seg.replace(/[.,;:!?)]+$/, ''));
    if (name) names.push(name);
  }
  return { names: names.slice(0, MAX_DEPTH), clipped: names.length > MAX_DEPTH };
}

/** Takes folder paths out of a line. The last path on the line counts. */
export function extractPaths(line: string): { rest: string; path: FolderPath | null } {
  let path = null as FolderPath | null;
  const rest = line.replace(PATH_RE, (tok) => {
    const p = readPath(tok);
    if (p.names.length) path = p;
    return p.names.length ? ' ' : tok;
  });
  return { rest: path ? rest.replace(/\s+/g, ' ').trim() : line, path };
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const HAS_URL = /https?:\/\//;
const BULLET = /^\s*(?:[-*•▪◦·>]|\d+[.)]|\[[ xX]\])\s+/;
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Drop trailing punctuation, but keep a closing paren that belongs to the URL (Wikipedia style). */
export function cleanUrl(u: string): string {
  let s = u;
  while (/[),.;:!?'"\]>]$/.test(s)) {
    const last = s[s.length - 1];
    if (last === ')' && (s.match(/\(/g) ?? []).length >= (s.match(/\)/g) ?? []).length) break;
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Numbered, non-empty lines with their links pulled out. Which lines belong together
 * (a post and its links, a paragraph and its questions) is decided later, by the AI.
 */
export function parseLines(input: string): ParsedLine[] {
  const text = input.replace(/\r\n?/g, '\n').replace(MD_LINK, (_m, label: string, url: string) => `${label}: ${url}`);
  const out: ParsedLine[] = [];
  let blank = false;
  let section: string[] | undefined;
  for (const line of text.split('\n')) {
    const source = line.replace(BULLET, '').trim();
    if (!source) {
      blank = out.length > 0;
      continue;
    }
    const { rest: raw, path } = extractPaths(source);
    if (path && !raw) {
      // A path on a line of its own: everything below goes there, until the next one.
      section = path.names;
      blank = out.length > 0;
      continue;
    }
    const urls = (raw.match(URL_RE) ?? []).map(cleanUrl);
    let rest = raw;
    for (const u of urls) rest = rest.replace(u, ' ');
    rest = rest.replace(/\s+/g, ' ').replace(/^[\s\-–—:|•(),;]+|[\s\-–—:|•(),;]+$/g, '').trim();
    out.push({
      n: out.length + 1, raw, source, text: rest, urls, blankBefore: blank,
      ...(path ? { folder: path.names } : {}),
      ...(section ? { section } : {}),
    });
    blank = false;
  }
  return out;
}

/**
 * Folder names from a name box, where spaces are fine: "Machine Learning", "Robotics › Papers",
 * "Robotics\Papers" or a typed path like \robotics\papers.
 */
export function folderNamesFrom(input: string): string[] {
  const t = input.trim();
  const typed = extractPaths(t);
  if (typed.path && !typed.rest) return typed.path.names;
  return splitPathName(t).map((n) => displayName(n, true)).slice(0, MAX_DEPTH);
}

/** Every folder path written in the text, and whether any went deeper than allowed. */
export function pathsIn(input: string): { paths: string[][]; clipped: boolean } {
  const paths: string[][] = [];
  let clipped = false;
  for (const line of input.split('\n')) {
    const { path } = extractPaths(line.replace(BULLET, '').trim());
    if (!path) continue;
    clipped ||= path.clipped;
    if (!paths.some((p) => p.join('\\').toLowerCase() === path!.names.join('\\').toLowerCase())) paths.push(path.names);
  }
  return { paths, clipped };
}

/** Every distinct link, in the order it appears. */
export function uniqueUrls(lines: ParsedLine[]): string[] {
  return [...new Set(lines.flatMap((l) => l.urls))];
}

/** Text that only names a link ("Video:", "Slides", "Reading list") rather than saying something. */
export const isLinkLabel = (l: ParsedLine) => l.urls.length === 1 && l.text.length <= 40 && !/[.?!]$/.test(l.text);

const INSTRUCTION = /^(?:please\s+|can you\s+)?(move|mark|unmark|create|make|add (?:a )?(?:new )?topic|new topic|delete|remove|rename|snooze|put|merge|prioriti[sz]e|rank|archive|reopen|set|uncheck|check off)\b/i;

/** Single-line, link-free text that starts like a command. The user can switch modes if this guesses wrong. */
export function looksLikeInstruction(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length < 400 && !t.includes('\n') && !HAS_URL.test(t) && INSTRUCTION.test(t);
}

/** Cut an oversized dump at a line break. Returns [now, later]. */
export function takeWithinLimit(text: string, maxChars = LIMITS.maxChars): [string, string] {
  if (text.length <= maxChars) return [text, ''];
  const cut = text.lastIndexOf('\n', maxChars);
  const at = cut > maxChars * 0.5 ? cut : maxChars;
  return [text.slice(0, at), text.slice(at).replace(/^\n+/, '')];
}
