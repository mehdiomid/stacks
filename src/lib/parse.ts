export const LIMITS = { maxLinks: 100, maxLines: 300, maxChars: 20_000 };

export interface ParsedLine {
  /** 1-based number, counting only non-empty lines. */
  n: number;
  /** The line as typed, minus list bullets. */
  raw: string;
  /** The line with its links taken out. */
  text: string;
  urls: string[];
  /** A blank line came before this one (a paragraph break). */
  blankBefore: boolean;
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
  for (const line of text.split('\n')) {
    const raw = line.replace(BULLET, '').trim();
    if (!raw) {
      blank = out.length > 0;
      continue;
    }
    const urls = (raw.match(URL_RE) ?? []).map(cleanUrl);
    let rest = raw;
    for (const u of urls) rest = rest.replace(u, ' ');
    rest = rest.replace(/\s+/g, ' ').replace(/^[\s\-–—:|•(),;]+|[\s\-–—:|•(),;]+$/g, '').trim();
    out.push({ n: out.length + 1, raw, text: rest, urls, blankBefore: blank });
    blank = false;
  }
  return out;
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
