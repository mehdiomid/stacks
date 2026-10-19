export type ItemKind = 'link' | 'video' | 'note';
export type TopicSort = 'oldest' | 'newest' | 'title';

export interface Topic {
  id: string;
  name: string;
  /** Position in the list. Lower is more important. */
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
}
