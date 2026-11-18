import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app-context';
import { getSetting, setSetting } from '../db';
import { chooseFolder, folderStatus, onBackupChange, reconnectFolder, type FolderStatus } from '../lib/backup';

// "Later" lasts until the page is reloaded, also across switching pages.
let laterThisSession = false;

/**
 * Keeps a copy on disk the normal setup: asks for a backup folder until one is chosen,
 * and asks to reconnect it after a browser restart. Browsers only allow both from a click.
 */
export function BackupBar() {
  const { toast } = useApp();
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [later, setLater] = useState(laterThisSession);
  const unsupportedSeen = useLiveQuery(() => getSetting('backupUnsupportedSeen', false), []);

  useEffect(() => {
    const refresh = () => void folderStatus().then(setStatus);
    refresh();
    const off = onBackupChange(refresh);
    window.addEventListener('focus', refresh);
    return () => {
      off();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const choose = () =>
    void chooseFolder()
      .then((name) => name && toast(`Backing up to ${name}`))
      .catch(() => {});
  const reconnect = () =>
    void reconnectFolder().then((ok) => toast(ok ? 'Backup folder reconnected' : 'Stacks still can’t write to the folder. Choose it again.'));

  if (!status) return null;

  if (!status.supported) {
    if (unsupportedSeen !== false) return null;
    return (
      <div className="backup-bar" role="status">
        <span>This browser can’t keep a copy in a folder on your disk (Chrome, Edge and Brave can). Use Export in Settings now and then to save one.</span>
        <button className="btn ghost small" onClick={() => void setSetting('backupUnsupportedSeen', true)}>
          OK
        </button>
      </div>
    );
  }

  if (!status.folder) {
    if (later) return null;
    return (
      <div className="backup-bar" role="status">
        <span>
          <b>Keep a copy of your stacks on your disk.</b> Choose a folder, such as Documents/Stacks or an iCloud Drive folder. Stacks saves to it after every change.
        </span>
        <span className="actions">
          <button className="btn small" onClick={choose}>
            Choose folder
          </button>
          <button
            className="linkish"
            onClick={() => {
              laterThisSession = true;
              setLater(true);
            }}
          >
            Later
          </button>
        </span>
      </div>
    );
  }

  if (status.permission === 'prompt') {
    return (
      <div className="backup-bar warn" role="status">
        <span>
          <b>Backups are paused.</b> After a restart, the browser needs your OK to write to <b>{status.folder}</b> again. Your changes are saved when you reconnect.
        </span>
        <button className="btn small" onClick={reconnect}>
          Reconnect folder
        </button>
      </div>
    );
  }

  if (status.permission === 'denied' || status.failed) {
    return (
      <div className="backup-bar warn" role="status">
        <span>
          <b>Backups are paused.</b> Stacks can’t write to <b>{status.folder}</b>. It may have been moved or deleted.
        </span>
        <button className="btn small" onClick={choose}>
          Choose folder
        </button>
      </div>
    );
  }

  return null;
}
