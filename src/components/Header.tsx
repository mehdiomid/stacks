import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app-context';
import { getAISettings, getKey, modelLabel, PROVIDERS } from '../settings';
import type { Page } from '../App';

export function Header({ page, onHome }: { page: Page; onHome: () => void }) {
  const { openSettings } = useApp();
  const status = useLiveQuery(async () => {
    const ai = await getAISettings();
    return { ai, hasKey: !!(await getKey(ai.provider)) };
  });
  const local = status?.ai.engine === 'local';
  const needsKey = !!status && !local && !status.hasKey;
  const where = !status
    ? 'Saved on this device'
    : local
      ? 'Saved and sorted on this device'
      : `Saved on this device · ${PROVIDERS[status.ai.provider].name} ${modelLabel(status.ai.provider, status.ai.models[status.ai.provider]).replace(/^Claude /, '')}`;

  return (
    <header className="top">
      <a className="brand" href="#" onClick={onHome}>
        <h1>Stacks</h1>
        <span>your reading &amp; watching backlog</span>
      </a>
      <nav className="nav" aria-label="Pages">
        <a href="#" onClick={onHome} aria-current={page === 'home' ? 'page' : undefined}>
          Stacks
        </a>
        <a href="#about" aria-current={page === 'about' ? 'page' : undefined}>
          About
        </a>
        <button type="button" onClick={() => openSettings()} title="Sorting (on this device, Claude or OpenAI), backups, reminders">
          Settings
        </button>
      </nav>
      <div className="top-actions">
        <span className="local" title={local ? 'Your lists live in this browser, and sorting runs here too' : 'Your lists live in this browser; sorting uses your API key'}>
          <span className="dot" aria-hidden="true" /> {where}
        </span>
        {needsKey && (
          <button className="chip-btn warn" onClick={() => openSettings()}>
            Add API key
          </button>
        )}
      </div>
    </header>
  );
}
