import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { folderStatus, type FolderStatus } from '../lib/backup';
import { agoShort, fmtNum, todayKey } from '../lib/time';

/** Today's AI tokens against the daily limit, plus where the data lives. Shown at the end of Settings. */
export function UsageSummary({ limit }: { limit: number }) {
  const used = useLiveQuery(async () => (await db.usage.get(todayKey()))?.tokens ?? 0) ?? 0;
  const lastBackup = useLiveQuery(() => db.settings.get('lastBackupAt'));
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void folderStatus().then(setFolder);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [lastBackup]);

  const safeLimit = Math.max(1, limit || 1);
  const pct = Math.min(100, Math.round((used / safeLimit) * 100));
  let backup = 'not set up';
  if (folder?.folder) backup = folder.permission === 'granted' ? folder.folder : `${folder.folder} (needs reconnect)`;
  else if (folder && !folder.supported) backup = 'export only in this browser';

  return (
    <div className="usage">
      <div className="usage-row">
        <span>
          {fmtNum(used)} / {fmtNum(safeLimit)} tokens
        </span>
        <span>{pct}%</span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={safeLimit} aria-valuenow={used} aria-label="AI tokens used today">
        <i className={pct >= 80 ? 'high' : ''} style={{ width: `${pct}%` }} />
      </div>
      <div className="storage">
        <div>
          <span>Data</span>
          <code>this browser{persisted ? ' (protected)' : ''}</code>
        </div>
        <div>
          <span>Backup folder</span>
          <code>{backup}</code>
        </div>
        {folder?.lastAt && (
          <div>
            <span>Last backup</span>
            <code>{agoShort(folder.lastAt)}</code>
          </div>
        )}
      </div>
    </div>
  );
}
