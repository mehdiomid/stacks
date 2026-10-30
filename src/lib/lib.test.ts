import { describe, expect, it } from 'vitest';
import { cleanUrl, isLinkLabel, looksLikeInstruction, parseLines, takeWithinLimit } from './parse';
import { recommend } from './scoring';
import { DAY } from './time';
import { isVideoUrl, normalizeUrl, titleFromUrl } from './url';
import type { Item, Topic } from '../types';

describe('parseLines', () => {
  it('numbers non-empty lines, pulls links out and marks paragraph breaks', () => {
    const p = parseLines('Intro paragraph.\n\nQuestion one?\n- Video: https://lnkd.in/a\n[Laws of UX](https://lawsofux.com/)');
    expect(p.map((l) => [l.n, l.text, l.urls, l.blankBefore])).toEqual([
      [1, 'Intro paragraph.', [], false],
      [2, 'Question one?', [], true],
      [3, 'Video', ['https://lnkd.in/a'], false],
      [4, 'Laws of UX', ['https://lawsofux.com/'], false],
    ]);
  });
  it('splits several links on one line and strips trailing punctuation', () => {
    expect(parseLines('see https://a.com, https://b.com.')[0].urls).toEqual(['https://a.com', 'https://b.com']);
  });
  it('tells a link label from a sentence', () => {
    const [label, sentence] = parseLines('Slides: https://x.com/s\nThis talk explains everything you need to know. https://x.com/t');
    expect(isLinkLabel(label)).toBe(true);
    expect(isLinkLabel(sentence)).toBe(false);
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
