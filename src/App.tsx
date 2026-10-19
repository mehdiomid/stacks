import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppContext } from './app-context';
import { db, getSetting, setSetting } from './db';
import { useReminders } from './lib/reminders';
import type { Item, Topic } from './types';
import { Header } from './components/Header';
import { Composer } from './components/Composer';
import { TopicList } from './components/TopicList';
import { UpNext } from './components/UpNext';
import { SettingsModal } from './components/SettingsModal';
import { AboutPage } from './components/AboutPage';
import { Sky } from './components/Sky';
import { Spark } from './components/Spark';

export type Page = 'home' | 'about';

function useHashPage(): Page {
  const read = (): Page => (window.location.hash === '#about' ? 'about' : 'home');
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const onChange = () => {
      setPage(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return page;
}

export default function App() {
  const topics = useLiveQuery(() => db.topics.orderBy('order').toArray(), []);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const hashPage = useHashPage();
  const introSeen = useLiveQuery(() => getSetting('introSeen', false), []);
  // First visit with nothing saved yet: open on About, which introduces the app.
  const page: Page = hashPage === 'home' && introSeen === false && topics?.length === 0 && !window.location.hash ? 'about' : hashPage;
  const tryStacks = useCallback(() => {
    void setSetting('introSeen', true);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (topics?.length && introSeen === false) void setSetting('introSeen', true);
  }, [topics, introSeen]);
  const [settings, setSettings] = useState<{ notice?: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);
  const actions = useMemo(() => ({ toast, openSettings: (notice?: string) => setSettings({ notice }) }), [toast]);

  useEffect(() => {
    // Ask the browser not to clear this site's storage when space runs low.
    void navigator.storage?.persist?.().catch(() => false);
  }, []);
  useReminders(topics, items);

  const doneCount = items?.filter((i) => i.doneAt).length ?? 0;

  return (
    <AppContext.Provider value={actions}>
      <Sky lit={doneCount} />
      <div className="wrap">
        <Header page={page} onHome={tryStacks} />
        {page === 'about' ? <AboutPage onTry={tryStacks} /> : topics && items && introSeen !== undefined ? <Home topics={topics} items={items} /> : <p className="hint">Opening your stacks…</p>}
      </div>
      {settings && <SettingsModal notice={settings.notice} onClose={() => setSettings(null)} />}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </AppContext.Provider>
  );
}

function Home({ topics, items }: { topics: Topic[]; items: Item[] }) {
  return (
    <>
      <Spark topics={topics} items={items} />
      <div className="grid">
        <main>
          <Composer topics={topics} items={items} />
          <TopicList topics={topics} items={items} />
        </main>
        <aside className="side">
          <UpNext topics={topics} items={items} />
        </aside>
      </div>
    </>
  );
}
