import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app-context';
import { db } from '../db';
import { folderStatus, type FolderStatus } from '../lib/backup';
import { agoShort, fmtNum, todayKey } from '../lib/time';
import { getAISettings } from '../settings';

export function UsagePanel() {
  const { openSettings } = useApp();
  const used = useLiveQuery(async () => (await db.usage.get(todayKey()))?.tokens ?? 0) ?? 0;
  const ai = useLiveQuery(getAISettings);
  const lastBackup = useLiveQuery(() => db.settings.get('lastBackupAt'));
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void folderStatus().then(setFolder);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [lastBackup]);

  const limit = ai?.dailyTokenLimit ?? 1;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  let backup = 'not set up';
  if (folder?.folder) backup = folder.permission === 'granted' ? folder.folder : `${folder.folder} (needs reconnect)`;
  else if (folder && !folder.supported) backup = 'export only in this browser';

  return (
    <section className="panel" aria-labelledby="usage-title">
      <h2 className="small" id="usage-title">
        AI usage today
      </h2>
      <div className="usage-row">
        <span>
          {fmtNum(used)} / {fmtNum(limit)} tokens
        </span>
        <span>{pct}%</span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Tokens used today">
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
      <p className="hint" style={{ marginTop: 10 }}>
        <button className="linkish" onClick={() => openSettings()}>
          Settings, backup &amp; export
        </button>
      </p>
    </section>
  );
}
