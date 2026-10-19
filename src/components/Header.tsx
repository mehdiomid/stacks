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
  const label = status
    ? `${PROVIDERS[status.ai.provider].name} · ${modelLabel(status.ai.provider, status.ai.models[status.ai.provider]).replace(/^Claude /, '')}`
    : 'Settings';

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
      </nav>
      <div className="top-actions">
        <span className="local" title="Your lists live in this browser, plus a backup folder if you choose one">
          ● Saved on this device
        </span>
        <button className="chip-btn" onClick={() => openSettings()} title="AI provider, API key, backups">
          <span className={`dot ${status?.hasKey ? '' : 'off'}`} />
          {status && !status.hasKey ? 'Add API key' : label}
        </button>
      </div>
    </header>
  );
}
