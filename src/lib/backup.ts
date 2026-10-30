import { db, getSetting, setSetting } from '../db';
import type { Item, Topic } from '../types';
import { childNamed, flattenTree, indexTree } from './tree';
import { todayKey } from './time';

/* File System Access API (Chrome, Edge, Brave, Opera). Not in TypeScript's DOM types yet. */
type Mode = { mode: 'read' | 'readwrite' };
interface PermissionedDir extends FileSystemDirectoryHandle {
  queryPermission(o: Mode): Promise<PermissionState>;
  requestPermission(o: Mode): Promise<PermissionState>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: Mode['mode'] }) => Promise<FileSystemDirectoryHandle> };

export const folderBackupSupported = () => typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';

export interface BackupFile {
  app: 'stacks';
  version: 1;
  exportedAt: string;
  topics: Topic[];
  items: Item[];
}

export async function snapshot(): Promise<BackupFile> {
  const [topics, items] = await Promise.all([db.topics.orderBy('order').toArray(), db.items.toArray()]);
  return { app: 'stacks', version: 1, exportedAt: new Date().toISOString(), topics, items };
}

/** Save a JSON file through the browser's normal download. API keys are never included. */
export async function downloadBackup(): Promise<void> {
  const data = await snapshot();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stacks-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function isBackup(v: unknown): v is BackupFile {
  const b = v as BackupFile;
  return !!b && b.app === 'stacks' && Array.isArray(b.topics) && Array.isArray(b.items);
}

/** Merge adds what's missing (folders by name and place, items by id and link). Replace wipes topics and items first. */
export async function importBackup(raw: unknown, mode: 'merge' | 'replace'): Promise<{ topics: number; items: number }> {
  if (!isBackup(raw)) throw new Error('This file is not a Stacks backup.');
  let added = { topics: 0, items: 0 };
  await db.transaction('rw', db.topics, db.items, async () => {
    if (mode === 'replace') {
      await db.topics.clear();
      await db.items.clear();
      await db.topics.bulkPut(raw.topics);
      await db.items.bulkPut(raw.items);
      added = { topics: raw.topics.length, items: raw.items.length };
      return;
    }
    // Folders are matched by their place in the tree (same name inside the same parent), parents first.
    const current = await db.topics.toArray();
    const incoming = indexTree(raw.topics);
    const remap = new Map<string, string>();
    for (const { topic: t } of flattenTree(raw.topics, incoming)) {
      const rp = incoming.parentOf(t);
      const parentId = rp ? remap.get(rp) ?? rp : null;
      const tree = indexTree(current);
      const same = childNamed(parentId, t.name, tree);
      if (same) remap.set(t.id, same.id);
      else if (!tree.byId.has(t.id)) {
        const row: Topic = { ...t, parentId, order: tree.children(parentId).reduce((m, x) => Math.max(m, x.order), -1) + 1 };
        await db.topics.add(row);
        current.push(row);
        added.topics++;
      }
    }
    const urls = new Set((await db.items.toArray()).map((i) => i.normUrl).filter(Boolean));
    for (const it of raw.items) {
      if (it.normUrl && urls.has(it.normUrl)) continue;
      if (await db.items.get(it.id)) continue;
      await db.items.add({ ...it, topicId: remap.get(it.topicId) ?? it.topicId });
      added.items++;
    }
  });
  return added;
}

/* ---- Automatic backup to a folder the user picks ---- */

export interface FolderStatus {
  supported: boolean;
  folder: string | null;
  permission: PermissionState | null;
  lastAt: number | null;
}

async function getHandle(): Promise<PermissionedDir | null> {
  return getSetting<PermissionedDir | null>('backupHandle', null);
}

export async function folderStatus(): Promise<FolderStatus> {
  const handle = await getHandle();
  const lastAt = await getSetting<number | null>('lastBackupAt', null);
  if (!folderBackupSupported() || !handle) return { supported: folderBackupSupported(), folder: handle?.name ?? null, permission: null, lastAt };
  let permission: PermissionState | null = null;
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    permission = null;
  }
  return { supported: true, folder: handle.name, permission, lastAt };
}

export async function chooseFolder(): Promise<string | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ id: 'stacks-backup', mode: 'readwrite' });
  await setSetting('backupHandle', handle);
  await writeFolderBackup();
  return handle.name;
}

/** Browsers ask again for folder access after a restart; this must run from a click. */
export async function reconnectFolder(): Promise<boolean> {
  const handle = await getHandle();
  if (!handle) return false;
  const state = await handle.requestPermission({ mode: 'readwrite' });
  if (state === 'granted') await writeFolderBackup();
  return state === 'granted';
}

export async function forgetFolder(): Promise<void> {
  await setSetting('backupHandle', null);
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
}

/** Writes stacks-backup.json (latest) and stacks-YYYY-MM-DD.json (one per day, as history). */
export async function writeFolderBackup(): Promise<'ok' | 'no-folder' | 'needs-permission' | 'error'> {
  const handle = await getHandle();
  if (!handle || !folderBackupSupported()) return 'no-folder';
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return 'needs-permission';
    const text = JSON.stringify(await snapshot(), null, 2);
    await writeFile(handle, 'stacks-backup.json', text);
    await writeFile(handle, `stacks-${todayKey()}.json`, text);
    await setSetting('lastBackupAt', Date.now());
    return 'ok';
  } catch {
    return 'error';
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleBackup(delay = 3000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void writeFolderBackup(), delay);
}
