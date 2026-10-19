import { getSetting, setSetting } from './db';

export type ProviderId = 'anthropic' | 'openai';

export interface AISettings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  /** Personal daily cap, counted in this browser. */
  dailyTokenLimit: number;
  rememberKeys: boolean;
}

export const DEFAULT_AI: AISettings = {
  provider: 'anthropic',
  models: { anthropic: 'claude-haiku-5-5', openai: 'gpt-5-mini' },
  dailyTokenLimit: 200_000,
  rememberKeys: true,
};

export const PROVIDERS: Record<ProviderId, { name: string; keyPrefix: string; keyUrl: string; limitsHint: string }> = {
  anthropic: {
    name: 'Claude',
    keyPrefix: 'sk-ant-',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    limitsHint: 'Also set a monthly spend limit in the Anthropic Console (Settings → Limits).',
  },
  openai: {
    name: 'OpenAI',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.openai.com/api-keys',
    limitsHint: 'Also set a monthly budget in the OpenAI dashboard (Settings → Limits).',
  },
};

export const MODEL_OPTIONS: Record<ProviderId, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · fastest and cheapest' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · balanced' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · most capable' },
  ],
  openai: [
    { id: 'gpt-5-mini', label: 'gpt-5-mini' },
    { id: 'gpt-5-nano', label: 'gpt-5-nano' },
    { id: 'gpt-5', label: 'gpt-5' },
  ],
};

export function modelLabel(provider: ProviderId, id: string): string {
  const found = MODEL_OPTIONS[provider].find((m) => m.id === id);
  return found ? found.label.split(' · ')[0] : id;
}

export async function getAISettings(): Promise<AISettings> {
  const saved = await getSetting<Partial<AISettings>>('ai', {});
  return { ...DEFAULT_AI, ...saved, models: { ...DEFAULT_AI.models, ...(saved.models ?? {}) } };
}

export async function saveAISettings(s: AISettings): Promise<void> {
  await setSetting('ai', s);
}

/* API keys: kept in IndexedDB when "remember" is on, otherwise only for this tab (sessionStorage). */
type KeyMap = Partial<Record<ProviderId, string>>;
const SESSION_KEY = 'stacks.keys';

function readSession(): KeyMap {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as KeyMap;
  } catch {
    return {};
  }
}
function writeSession(v: KeyMap) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the key lives only in memory for this call */
  }
}

export async function getKey(p: ProviderId): Promise<string> {
  const stored = await getSetting<KeyMap>('keys', {});
  return stored[p] || readSession()[p] || '';
}

export async function setKey(p: ProviderId, key: string, remember: boolean): Promise<void> {
  const stored = { ...(await getSetting<KeyMap>('keys', {})) };
  const session = readSession();
  delete stored[p];
  delete session[p];
  const trimmed = key.trim();
  if (trimmed) {
    if (remember) stored[p] = trimmed;
    else session[p] = trimmed;
  }
  await setSetting('keys', stored);
  writeSession(session);
}
