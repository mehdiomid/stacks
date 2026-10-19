export interface Piece {
  url: string | null;
  /** Text around the link, or the whole note. */
  text: string;
}

export const LIMITS = { maxPieces: 100, maxChars: 20_000 };

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

function lineToPieces(line: string): Piece[] {
  const urls = (line.match(URL_RE) ?? []).map(cleanUrl);
  if (!urls.length) return [{ url: null, text: line }];
  let rest = line;
  for (const u of urls) rest = rest.replace(u, ' ');
  rest = rest.replace(/\s+/g, ' ').replace(/^[\s\-–—:|•(),;]+|[\s\-–—:|•(),;]+$/g, '').trim();
  return urls.map((url) => ({ url, text: rest }));
}

/**
 * Split a free-form dump into pieces.
 * - Every link becomes its own piece, with the text on its line as context.
 * - A paragraph without links stays together as one note.
 * - A list (bullets, or several short lines) becomes one piece per line.
 */
export function splitPieces(input: string): Piece[] {
  const text = input.replace(/\r\n?/g, '\n').replace(MD_LINK, (_m, label: string, url: string) => `${url} ${label}`);
  const out: Piece[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const raw = block.split('\n').filter((l) => l.trim());
    if (!raw.length) continue;
    const bulleted = raw.filter((l) => BULLET.test(l)).length;
    const lines = raw.map((l) => l.replace(BULLET, '').trim()).filter(Boolean);
    const hasUrl = lines.some((l) => HAS_URL.test(l));
    const isList = bulleted * 2 >= lines.length || lines.every((l) => l.length <= 100);
    if (!hasUrl && lines.length > 1 && !isList) {
      out.push({ url: null, text: lines.join('\n') });
      continue;
    }
    for (const line of lines) out.push(...lineToPieces(line));
  }
  // The same link twice in one dump counts once.
  const seen = new Set<string>();
  return out.filter((p) => {
    if (!p.url) return true;
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

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
