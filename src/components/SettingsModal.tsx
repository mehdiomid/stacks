import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context';
import { getSetting, setSetting } from '../db';
import {
  chooseFolder,
  downloadBackup,
  folderBackupSupported,
  folderStatus,
  forgetFolder,
  importBackup,
  reconnectFolder,
  writeFolderBackup,
  type FolderStatus,
} from '../lib/backup';
import { agoShort } from '../lib/time';
import { deleteAllLists } from '../store';
import { DEFAULT_AI, getAISettings, getKey, MODEL_OPTIONS, PROVIDERS, saveAISettings, setKey, type AISettings, type ProviderId } from '../settings';

export function SettingsModal({ notice, onClose }: { notice?: string; onClose: () => void }) {
  const { toast } = useApp();
  const [ai, setAi] = useState<AISettings>(DEFAULT_AI);
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ anthropic: '', openai: '' });
  const [showKey, setShowKey] = useState(false);
  const [notify, setNotify] = useState(false);
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [loaded, setLoaded] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setAi(await getAISettings());
      setKeys({ anthropic: await getKey('anthropic'), openai: await getKey('openai') });
      setNotify(await getSetting('notify', false));
      setFolder(await folderStatus());
      setLoaded(true);
      keyRef.current?.focus();
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const p = ai.provider;
  const info = PROVIDERS[p];
  const refreshFolder = async () => setFolder(await folderStatus());

  async function save() {
    const limit = Math.max(1000, Math.round(ai.dailyTokenLimit) || DEFAULT_AI.dailyTokenLimit);
    await saveAISettings({ ...ai, dailyTokenLimit: limit });
    for (const id of Object.keys(keys) as ProviderId[]) await setKey(id, keys[id], ai.rememberKeys);
    await setSetting('notify', notify);
    toast('Settings saved');
    onClose();
  }

  async function toggleNotify(on: boolean) {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') {
        toast('Notifications are blocked for this site in your browser settings');
        return setNotify(false);
      }
    }
    setNotify(on);
  }

  async function runImport(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const r = await importBackup(data, importMode);
      toast(importMode === 'replace' ? `Replaced with ${r.items} items in ${r.topics} topics` : `Added ${r.items} items and ${r.topics} topics`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That file could not be read');
    }
  }

  const keyLooksOff = keys[p] && !keys[p].startsWith(info.keyPrefix);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h3 id="settings-title">Settings</h3>
        <p>Your key stays in this browser and goes straight to the AI provider. The Stacks server never sees it.</p>
        {notice && <div className="notice">{notice}</div>}

        <div className="field">
          <label id="provider-label">AI provider</label>
          <div className="seg" role="group" aria-labelledby="provider-label">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
              <button key={id} aria-pressed={p === id} onClick={() => setAi({ ...ai, provider: id })}>
                {id === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="api-key">{info.name} API key</label>
          <div className="row-input">
            <input
              id="api-key"
              ref={keyRef}
              type={showKey ? 'text' : 'password'}
              value={keys[p]}
              placeholder={`${info.keyPrefix}…`}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
            />
            <button className="btn ghost small" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <small>
            Create one at{' '}
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">
              {new URL(info.keyUrl).host}
            </a>
            . A Claude or ChatGPT subscription doesn't include API access; API use is billed separately.
            {keyLooksOff && ` This doesn't look like a ${info.name} key (they start with ${info.keyPrefix}).`}
          </small>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          {p === 'anthropic' ? (
            <select id="model" value={ai.models.anthropic} onChange={(e) => setAi({ ...ai, models: { ...ai.models, anthropic: e.target.value } })}>
              {MODEL_OPTIONS.anthropic.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input id="model" list="openai-models" value={ai.models.openai} onChange={(e) => setAi({ ...ai, models: { ...ai.models, openai: e.target.value.trim() } })} />
              <datalist id="openai-models">
                {MODEL_OPTIONS.openai.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
              <small>Any OpenAI model that supports structured outputs works. Type its name if it isn't listed.</small>
            </>
          )}
        </div>

        <div className="field">
          <label htmlFor="limit">My daily token limit</label>
          <input id="limit" type="number" min={1000} step={10000} value={ai.dailyTokenLimit} onChange={(e) => setAi({ ...ai, dailyTokenLimit: Number(e.target.value) })} />
          <small>Stacks stops calling the AI for the rest of the day when this is reached. A dump of 50 links uses roughly 10,000 tokens.</small>
        </div>
        <div className="tip">{info.limitsHint}</div>

        <div className="row" style={{ marginBottom: 6 }}>
          <input type="checkbox" id="remember" checked={ai.rememberKeys} onChange={(e) => setAi({ ...ai, rememberKeys: e.target.checked })} />
          <label htmlFor="remember">Remember keys on this device (otherwise only until this tab closes)</label>
        </div>
        <button
          className="linkish"
          onClick={() => {
            setKeys({ ...keys, [p]: '' });
            void setKey(p, '', false).then(() => toast(`${info.name} key removed from this browser`));
          }}
        >
          Forget my {info.name} key
        </button>

        <h4>Backup</h4>
        {folderBackupSupported() ? (
          <>
            <p>
              Stacks can keep a copy in a folder you choose, such as Documents/Stacks or a synced folder. It writes <code>stacks-backup.json</code> after each change, plus one dated file per day.
            </p>
            <div className="row" style={{ marginBottom: 8 }}>
              {folder?.folder ? (
                <>
                  <span>
                    Folder: <b>{folder.folder}</b>
                    {folder.lastAt ? ` · last backup ${agoShort(folder.lastAt)}` : ''}
                  </span>
                  {folder.permission !== 'granted' ? (
                    <button className="btn small" onClick={() => void reconnectFolder().then(refreshFolder)}>
                      Reconnect folder
                    </button>
                  ) : (
                    <button className="btn ghost small" onClick={() => void writeFolderBackup().then(refreshFolder).then(() => toast('Backed up'))}>
                      Back up now
                    </button>
                  )}
                  <button className="btn ghost small" onClick={() => void chooseFolder().then(refreshFolder).catch(() => {})}>
                    Change
                  </button>
                  <button className="linkish" onClick={() => void forgetFolder().then(refreshFolder)}>
                    Stop
                  </button>
                </>
              ) : (
                <button className="btn small" onClick={() => void chooseFolder().then(refreshFolder).catch(() => {})}>
                  Choose backup folder
                </button>
              )}
            </div>
          </>
        ) : (
          <p>This browser can't write to a folder (Chrome, Edge and Brave can). Use Export to save a copy.</p>
        )}
        <div className="row">
          <button className="btn ghost small" onClick={() => void downloadBackup()}>
            Export JSON
          </button>
          <button className="btn ghost small" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')} aria-label="Import mode">
            <option value="merge">Import adds to my lists</option>
            <option value="replace">Import replaces my lists</option>
          </select>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void runImport(f);
              e.target.value = '';
            }}
          />
        </div>

        <h4>Start over</h4>
        <p>Delete every topic and item to start with empty stacks. Your settings, API key and backup folder stay. Export first if you might want them back.</p>
        <div className="row">
          {confirmWipe ? (
            <>
              <span>Delete all your topics and items?</span>
              <button
                className="btn danger small"
                onClick={() =>
                  void deleteAllLists().then(() => {
                    toast('All lists deleted. Your stacks are empty.');
                    onClose();
                  })
                }
              >
                Delete everything
              </button>
              <button className="btn ghost small" onClick={() => setConfirmWipe(false)}>
                Keep my lists
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setConfirmWipe(true)}>
              Delete all my lists…
            </button>
          )}
        </div>

        <h4>Reminders</h4>
        <div className="row">
          <input type="checkbox" id="notify" checked={notify} onChange={(e) => void toggleNotify(e.target.checked)} />
          <label htmlFor="notify">Send me a desktop notification for my top “Up next” pick, at most once a day while Stacks is open</label>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => void save()} disabled={!loaded}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
