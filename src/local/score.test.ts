import { describe, expect, it } from 'vitest';
import type { Item, Topic } from '../types';
import { candidateFolders, centroid, distinctiveWords, itemText, joinCandidate, latestIn, rankFolders, sharesPhrase, titleFrequency, WEAK_MATCH } from './score';
import { cleanPath, folderMessages } from './namer';

const topic = (id: string, name: string, order: number, parentId: string | null = null): Topic => ({
  id, name, order, parentId, hue: 0, createdAt: 0, lastActivityAt: 0, open: true, sort: 'oldest',
});
const item = (id: string, topicId: string, title: string, addedAt = 0): Item => ({
  id, topicId, title, addedAt, kind: 'link', url: null, normUrl: null, description: '', siteName: '', author: '', image: null, duration: null, doneAt: null, snoozedUntil: null, dismissed: false,
});
const v = (...xs: number[]) => centroid([Float32Array.from(xs)]);

describe('local folder choice', () => {
  const topics = [topic('rob', 'Robotics', 0), topic('pap', 'Papers', 0, 'rob'), topic('hw', 'Hardware', 1, 'rob'), topic('om', 'Open Models', 1), topic('in', 'Inbox', 2), topic('ml', 'ML', 3)];
  const items = [item('a', 'om', 'Llama 4'), item('b', 'pap', 'RT-2'), item('c', 'rob', 'Robot news')];

  it('offers 2-level folders and older 1-level folders that hold items, never Inbox or a parent', () => {
    expect(candidateFolders(topics, items).map((t) => t.id)).toEqual(['pap', 'hw', 'om']);
    // \robotics typed: only its subfolders
    expect(candidateFolders(topics, items, 'rob').map((t) => t.id)).toEqual(['pap', 'hw']);
  });

  it('ranks folders by the average of their path and latest items', () => {
    const vecs: Record<string, Float32Array[]> = { pap: [v(1, 0, 0), v(0.9, 0.1, 0)], hw: [v(0, 1, 0)], om: [v(0, 0, 1)] };
    const r = rankFolders(v(1, 0.05, 0), topics.filter((t) => vecs[t.id]), (t) => vecs[t.id]);
    expect(r.map((x) => x.topic.id)).toEqual(['pap', 'hw', 'om']);
    expect(r[0].score).toBeGreaterThan(WEAK_MATCH);
    expect(r[2].score).toBeLessThan(WEAK_MATCH);
  });

  it('describes a folder by its newest items', () => {
    const list = [item('x', 'pap', 'old', 1), item('y', 'pap', 'new', 9), item('z', 'pap', 'mid', 5)];
    expect(latestIn('pap', list, 2).map((i) => i.id)).toEqual(['y', 'z']);
    expect(itemText('Talk', ' my\n notes ')).toBe('Talk. my notes');
  });
});

describe('adding to an item you already have', () => {
  const saved = [
    item('c285', 'rl', 'Berkeley CS285 Deep Reinforcement Learning — Lecture 1'),
    item('viz', 'rl', 'Vizuara: Modern Robot Learning from Scratch — Lectures 3–4'),
    item('rl2', 'rl', 'Imitation learning explained'),
  ];
  const df = titleFrequency(saved.map((i) => i.title));
  const vecs: Record<string, Float32Array> = { c285: v(1, 0, 0), viz: v(0, 1, 0), rl2: v(0.7, 0.7, 0) };

  it('joins only when very similar AND sharing a distinctive name', () => {
    expect(joinCandidate(v(1, 0.1, 0), 'CS285 Deep RL Lecture 5: Policy Gradients', saved, (id) => vecs[id], df)?.item.id).toBe('c285');
    // Same subject, different course: similar, but no shared name.
    expect(joinCandidate(v(1, 0.1, 0), 'Stanford CS234 Reinforcement Learning — Lecture 3', saved, (id) => vecs[id], df)?.item.id).not.toBe('c285');
    // Shared name, but not similar enough.
    expect(joinCandidate(v(0, 0, 1), 'CS285 homework solutions', saved, (id) => vecs[id], df)).toBeNull();
  });

  it('needs less similarity when both titles share a named phrase', () => {
    // 0.8 similar to the Vizuara course: below the usual bar, enough with "modern robot learning" shared.
    const q = v(0.6, 0.8, 0);
    expect(joinCandidate(q, 'Lecture 5 - Diffusion Policy | Modern Robot Learning from Scratch', saved, (id) => vecs[id], df)?.item.id).toBe('viz');
    expect(joinCandidate(q, 'Lecture 5 - Diffusion Policy', saved, (id) => vecs[id], df)).toBeNull();
    // "learning from scratch" alone is generic and doesn't lower the bar.
    expect(sharesPhrase('Machine learning from scratch', 'Deep learning from scratch')).toBe(false);
    expect(sharesPhrase('Coursera Modern Robotics Specialization', 'Vizuara: Modern Robot Learning from Scratch')).toBe(false);
    // A shared topic is not a shared series.
    expect(sharesPhrase('Steering vision-language-action policies for grasping', 'RT-2: Vision-Language-Action Models Transfer Web Knowledge')).toBe(false);
  });

  it('ignores words that say what kind of thing it is', () => {
    expect([...distinctiveWords('Lecture 5 - Deep Learning course part 2', df)]).toEqual([]);
    expect(distinctiveWords('Rustlings walkthrough part 2', df).has('rustlings')).toBe(true);
  });
});

describe('new folder proposals', () => {
  it('keeps a usable Area › Subfolder and rejects the rest', () => {
    expect(cleanPath(' Finance › Investing. ')).toEqual(['Finance', 'Investing']);
    expect(cleanPath('Robotics')).toBeNull();
    expect(cleanPath('Area › Subject')).toBeNull();
    expect(cleanPath('Japan › Japan')).toBeNull();
  });

  it('tells the model your areas, with examples that reuse one and make a new one', () => {
    const m = folderMessages('Index funds vs ETFs explained', ['Robotics', 'Cooking']);
    expect(m.filter((x) => x.role === 'assistant').map((x) => x.content)).toEqual(['Gardening › Vegetables', 'Music › Guitar', 'Home › Plumbing', 'Photography › Film Cameras']);
    expect(m.at(-1)?.content).toBe('Existing areas: Robotics, Cooking\nItem: "Index funds vs ETFs explained"\nFolder (Area › Subfolder):');
  });
});
