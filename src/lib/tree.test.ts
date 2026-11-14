import { describe, expect, it } from 'vitest';
import { extractPaths, folderNamesFrom, parseLines, pathsIn, readPath } from './parse';
import { canNest, displayName, findByName, flattenTree, indexTree, nameKey, resolvePath, typedPath } from './tree';
import { recommend } from './scoring';
import type { Topic } from '../types';

const topic = (id: string, name: string, order: number, parentId: string | null = null): Topic => ({
  id, name, order, parentId, hue: 0, createdAt: 0, lastActivityAt: Date.now(), open: true, sort: 'oldest',
});

describe('typed folder paths', () => {
  it('reads plain, hyphenated, underscored and quoted names', () => {
    expect(readPath('\\robotics').names).toEqual(['Robotics']);
    expect(readPath('\\robotics\\papers').names).toEqual(['Robotics', 'Papers']);
    expect(readPath('\\machine-learning\\open_models').names).toEqual(['Machine Learning', 'Open Models']);
    expect(readPath('\\"Machine Learning"\\papers').names).toEqual(['Machine Learning', 'Papers']);
    expect(readPath('\\“GPT-5 notes”').names).toEqual(['GPT-5 notes']);
    expect(readPath('\\AI\\iOS').names).toEqual(['AI', 'iOS']);
  });

  it('keeps 3 levels and says when it dropped more', () => {
    expect(readPath('\\a\\b\\c\\d')).toEqual({ names: ['A', 'B', 'C'], clipped: true });
  });

  it('takes the path out of a line and leaves links and Windows paths alone', () => {
    expect(extractPaths('https://a.com/x \\robotics.')).toEqual({ rest: 'https://a.com/x', path: { names: ['Robotics'], clipped: false } });
    expect(extractPaths('saved in C:\\Users\\me').path).toBeNull();
    expect(extractPaths('no folder here').path).toBeNull();
  });

  it('applies a path to its own line, or to every line below a path line', () => {
    const lines = parseLines('\\robotics\\papers\nhttps://arxiv.org/1\nhttps://arxiv.org/2 \\reading\n\\cooking\nhttps://pizza.com');
    expect(lines.map((l) => [l.raw, l.folder ?? null, l.section ?? null])).toEqual([
      ['https://arxiv.org/1', null, ['Robotics', 'Papers']],
      ['https://arxiv.org/2', ['Reading'], ['Robotics', 'Papers']],
      ['https://pizza.com', null, ['Cooking']],
    ]);
    // A path line starts a new paragraph, so the AI sees the break.
    expect(lines[2].blankBefore).toBe(true);
  });

  it('treats "put the following under \\x" as a folder line, not a note', () => {
    const lines = parseLines('Put the following under \\robotics\\papers:\nhttps://arxiv.org/1\nSave these in \\cooking\nhttps://pizza.com\nput this under \\reading https://blog.com/a');
    expect(lines.map((l) => [l.raw, l.text, l.folder ?? null, l.section ?? null])).toEqual([
      ['https://arxiv.org/1', '', null, ['Robotics', 'Papers']],
      ['https://pizza.com', '', null, ['Cooking']],
      ['https://blog.com/a', '', ['Reading'], ['Cooking']],
    ]);
    // A note that merely mentions a folder keeps its words.
    expect(parseLines('Great grasping survey \\robotics')[0].raw).toBe('Great grasping survey');
  });

  it('accepts forward slashes where they cannot be ordinary text', () => {
    const lines = parseLines('Put the following under /folder1/folder2\nhttps://a.com/x\n/cooking\nhttps://b.com/y /reading');
    expect(lines.map((l) => [l.raw, l.folder ?? null, l.section ?? null])).toEqual([
      ['https://a.com/x', null, ['Folder1', 'Folder2']],
      ['https://b.com/y', ['Reading'], ['Cooking']],
    ]);
    expect(extractPaths('edit /etc/hosts first').path).toBeNull();
    expect(extractPaths('AI/ML notes').path).toBeNull();
    expect(extractPaths('https://a.com/b/c').path).toBeNull();
  });

  it('lists the paths in a paste for the hint', () => {
    expect(pathsIn('\\robotics\nx \\Robotics\ny \\a\\b\\c\\d')).toEqual({ paths: [['Robotics'], ['A', 'B', 'C']], clipped: true });
  });

  it('reads folder names from a name box, where spaces are fine', () => {
    expect(folderNamesFrom('Machine Learning')).toEqual(['Machine Learning']);
    expect(folderNamesFrom('Robotics › Papers')).toEqual(['Robotics', 'Papers']);
    expect(folderNamesFrom('\\robotics\\papers')).toEqual(['Robotics', 'Papers']);
    expect(folderNamesFrom('AI/ML')).toEqual(['AI/ML']);
  });

  it('writes a path back the way you would type it', () => {
    expect(typedPath(['Robotics', 'Papers'])).toBe('\\Robotics\\Papers');
    expect(typedPath(['Machine Learning'])).toBe('\\Machine-Learning');
    expect(typedPath(['Open-Source'])).toBe('\\"Open-Source"');
    expect(readPath(typedPath(['Machine Learning', 'Rust & Systems'])).names).toEqual(['Machine Learning', 'Rust & Systems']);
  });

  it('compares names ignoring case, spaces, hyphens and underscores', () => {
    expect(nameKey('Open Models')).toBe(nameKey('open-models'));
    expect(nameKey('open_models')).toBe(nameKey('OpenModels'));
    expect(displayName('machine-learning')).toBe('Machine Learning');
  });
});

describe('folder tree', () => {
  const topics = [
    topic('rob', 'Robotics', 0),
    topic('pap', 'Papers', 0, 'rob'),
    topic('gra', 'Grasping', 0, 'pap'),
    topic('kit', 'Kits', 1, 'rob'),
    topic('ml', 'Machine Learning', 1),
    topic('mlp', 'Papers', 0, 'ml'),
  ];
  const tree = indexTree(topics);

  it('lists folders in priority order: each folder, then what is inside it', () => {
    expect(flattenTree(topics).map((f) => `${f.depth}:${f.path.join('/')}`)).toEqual([
      '1:Robotics', '2:Robotics/Papers', '3:Robotics/Papers/Grasping', '2:Robotics/Kits', '1:Machine Learning', '2:Machine Learning/Papers',
    ]);
  });

  it('finds the existing part of a path and what is missing', () => {
    expect(resolvePath(['robotics', 'papers'], tree)).toEqual({ topic: topics[1], missing: [] });
    expect(resolvePath(['Robotics', 'Grippers'], tree)).toEqual({ topic: topics[0], missing: ['Grippers'] });
    expect(resolvePath(['Cooking'], tree)).toEqual({ topic: null, missing: ['Cooking'] });
  });

  it('finds a folder by full path, or by a single name preferring the shallowest', () => {
    expect(findByName('Machine Learning › Papers', topics)?.id).toBe('mlp');
    expect(findByName('\\machine-learning\\papers', topics)?.id).toBe('mlp');
    expect(findByName('papers', topics)?.id).toBe('pap');
    expect(findByName('open-models', topics)).toBeNull();
  });

  it('refuses nesting that would loop or go deeper than 3 levels', () => {
    expect(canNest('kit', 'pap', tree)).toBe(true);
    expect(canNest('pap', 'kit', tree)).toBe(false); // Papers has Grasping inside: 4 levels
    expect(canNest('rob', 'gra', tree)).toBe(false); // into its own subfolder
    expect(canNest('ml', 'rob', tree)).toBe(true);
    expect(canNest('gra', null, tree)).toBe(true);
  });

  it('treats a folder whose parent is missing as top level', () => {
    const t = indexTree([topic('a', 'A', 0, 'gone')]);
    expect(t.children(null).map((x) => x.id)).toEqual(['a']);
  });

  it('ranks Up next by tree order, so a subfolder comes right after its parent', () => {
    const now = Date.now();
    const item = (id: string, topicId: string) => ({
      id, topicId, kind: 'link' as const, url: null, normUrl: null, title: id, description: '', siteName: '', author: '', image: null, duration: null,
      addedAt: now, doneAt: null, snoozedUntil: null, dismissed: false,
    });
    const recs = recommend(topics, [item('m', 'ml'), item('g', 'gra'), item('r', 'rob')], now, 4, 2);
    expect(recs.map((r) => r.item.id)).toEqual(['r', 'g', 'm']);
  });
});
