export type ItemKind = 'link' | 'video' | 'note';
export type TopicSort = 'oldest' | 'newest' | 'title';

export interface Topic {
  id: string;
  name: string;
  /** The folder this one is inside, or absent/null at the top level. */
  parentId?: string | null;
  /** Position among the folders with the same parent. Lower is more important. */
  order: number;
  hue: number;
  createdAt: number;
  /** Last time something in this topic was finished (or when it was created). */
  lastActivityAt: number;
  open: boolean;
  sort: TopicSort;
  /** Created by "Load example topics". */
  example?: boolean;
}

/** One of several links that belong to the same item (e.g. a lecture's video, slides and reading list). */
export interface ItemLink {
  url: string;
  normUrl: string | null;
  /** What your text called it: "Video", "Slides", "Reading list". */
  label: string;
  /** The page's own title, when the preview had a useful one. */
  title: string;
  siteName: string;
  image: string | null;
  kind: 'link' | 'video';
  duration: number | null;
}

export interface Item {
  id: string;
  topicId: string;
  kind: ItemKind;
  url: string | null;
  /** Comparable form of the URL, used to spot duplicates. */
  normUrl: string | null;
  title: string;
  description: string;
  siteName: string;
  author: string;
  image: string | null;
  /** Seconds, for videos. */
  duration: number | null;
  addedAt: number;
  doneAt: number | null;
  snoozedUntil: number | null;
  /** "Not interested": kept in the list, never recommended. */
  dismissed: boolean;
  /** Created by "Load example topics". */
  example?: boolean;
  /** All links of a multi-link item, the main one included. Absent for single-link items. */
  links?: ItemLink[];
}

/** Local mode: an item's embedding, and what it was made from (to know when to redo it). */
export interface ItemVector {
  itemId: string;
  model: string;
  /** Hash of the embedded text; a different hash means the title or notes changed. */
  key: string;
  vec: Float32Array;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface UsageDay {
  date: string;
  tokens: number;
}

export interface Preview {
  url: string;
  title: string;
  description: string;
  siteName: string;
  author: string;
  image: string | null;
  duration: number | null;
  kind: 'link' | 'video';
  /** The real destination when the link was a short link or redirect page. */
  resolvedUrl?: string;
}
