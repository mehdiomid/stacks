import { describe, expect, it } from 'vitest';
import { cleanUrl, looksLikeInstruction, splitPieces, takeWithinLimit } from './parse';
import { recommend } from './scoring';
import { DAY } from './time';
import { isVideoUrl, normalizeUrl, titleFromUrl } from './url';
import type { Item, Topic } from '../types';

describe('splitPieces', () => {
  it('makes one piece per link and keeps the text on its line', () => {
    const p = splitPieces('https://a.com/x  intro to LLMs\n- https://b.com/y\nRust atomics book https://marabos.nl/atomics/');
    expect(p).toEqual([
      { url: 'https://a.com/x', text: 'intro to LLMs' },
      { url: 'https://b.com/y', text: '' },
      { url: 'https://marabos.nl/atomics/', text: 'Rust atomics book' },
    ]);
  });

  it('splits several links on one line', () => {
    expect(splitPieces('https://a.com, https://b.com').map((x) => x.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('keeps a paragraph of prose as one note', () => {
    const text = 'I want to learn about vector databases because our search at work is slow and someone mentioned pgvector.\nAlso look at how HNSW indexes work, and compare it with IVF for large collections.';
    expect(splitPieces(text)).toEqual([{ url: null, text }]);
  });

  it('treats a bullet list as separate notes', () => {
    expect(splitPieces('- sourdough recipe\n- tax-loss harvesting\n- Anki deck for kanji').length).toBe(3);
  });

  it('reads markdown links and drops duplicates', () => {
    const p = splitPieces('[Laws of UX](https://lawsofux.com/)\nhttps://lawsofux.com/');
    expect(p).toEqual([{ url: 'https://lawsofux.com/', text: 'Laws of UX' }]);
  });
});

describe('cleanUrl', () => {
  it('drops trailing punctuation but keeps balanced parens', () => {
    expect(cleanUrl('https://a.com/x).')).toBe('https://a.com/x');
    expect(cleanUrl('https://en.wikipedia.org/wiki/Rust_(programming_language)')).toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)');
  });
});

describe('looksLikeInstruction', () => {
  it('spots commands and ignores links and notes', () => {
    expect(looksLikeInstruction('move all pizza items to Cooking')).toBe(true);
    expect(looksLikeInstruction('Mark the Karpathy video done')).toBe(true);
    expect(looksLikeInstruction('move https://a.com to ML')).toBe(false);
    expect(looksLikeInstruction('sourdough recipe from Maria')).toBe(false);
  });
});

describe('takeWithinLimit', () => {
  it('cuts at a line break', () => {
    const [now, later] = takeWithinLimit('aaaa\nbbbb\ncccc', 11);
    expect(now).toBe('aaaa\nbbbb');
    expect(later).toBe('cccc');
  });
});

describe('url helpers', () => {
  it('normalizes so the same page matches', () => {
    expect(normalizeUrl('https://www.example.com/a/?utm_source=x&b=2')).toBe('example.com/a?b=2');
    expect(normalizeUrl('https://youtu.be/kCc8FmEb1nY?si=abc')).toBe('youtube.com/watch?v=kCc8FmEb1nY');
    expect(normalizeUrl('https://www.youtube.com/watch?v=kCc8FmEb1nY&t=30')).toBe('youtube.com/watch?v=kCc8FmEb1nY');
    expect(normalizeUrl('ftp://x')).toBeNull();
  });
  it('detects videos and guesses titles', () => {
    expect(isVideoUrl('https://www.youtube.com/watch?v=1')).toBe(true);
    expect(isVideoUrl('https://www.youtube.com/@channel')).toBe(false);
    expect(titleFromUrl('https://blog.com/posts/how-to-bake-bread.html')).toBe('How to bake bread');
  });
});

describe('recommend', () => {
  const now = Date.UTC(2026, 9, 19);
  const topic = (id: string, order: number, idleDays: number): Topic => ({ id, name: id, order, hue: 0, createdAt: 0, lastActivityAt: now - idleDays * DAY, open: true, sort: 'oldest' });
  const item = (id: string, topicId: string, ageDays: number, extra: Partial<Item> = {}): Item => ({
    id, topicId, kind: 'link', url: null, normUrl: null, title: id, description: '', siteName: '', author: '', image: null, duration: null,
    addedAt: now - ageDays * DAY, doneAt: null, snoozedUntil: null, dismissed: false, ...extra,
  });

  it('prefers the top topic and skips done, snoozed and dismissed items', () => {
    const topics = [topic('ml', 0, 1), topic('cooking', 1, 1)];
    const items = [
      item('a', 'ml', 5), item('b', 'cooking', 5),
      item('done', 'ml', 90, { doneAt: now }), item('snz', 'ml', 90, { snoozedUntil: now + DAY }), item('no', 'ml', 90, { dismissed: true }),
    ];
    const recs = recommend(topics, items, now);
    expect(recs.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(recs[0].reason).toBe('Your top topic');
  });

  it('caps picks per topic and names neglect', () => {
    const topics = [topic('ml', 0, 1), topic('finance', 1, 45)];
    const items = [item('a', 'ml', 2), item('b', 'ml', 2), item('c', 'ml', 2), item('f', 'finance', 2)];
    const recs = recommend(topics, items, now);
    expect(recs.filter((r) => r.topic.id === 'ml').length).toBe(2);
    expect(recs.find((r) => r.item.id === 'f')?.reason).toBe('finance untouched 45 days');
  });
});
