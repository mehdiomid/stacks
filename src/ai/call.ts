import { estimateTokens, addTokens, tokensToday } from '../lib/usage';
import { fmtNum } from '../lib/time';
import { getAISettings, getKey, modelLabel, PROVIDERS, type ProviderId } from '../settings';
import { AIError } from './errors';
import type { Provider } from './providers';

/** Each SDK is loaded the first time its provider is used, so the page itself stays small. */
const ADAPTERS: Record<ProviderId, () => Promise<Provider>> = {
  anthropic: async () => (await import('./anthropic')).anthropicProvider,
  openai: async () => (await import('./openai')).openaiProvider,
};

export interface AICall {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
}

/** Rough upper estimate shown before a call and checked against the daily limit. */
export function estimateCall(c: Pick<AICall, 'system' | 'user' | 'maxTokens'>): number {
  return estimateTokens(c.system + c.user) + Math.round(c.maxTokens * 0.25);
}

/** Checks the key and the daily budget, calls the chosen provider, records usage, parses JSON. */
export async function callAI(c: AICall): Promise<{ json: unknown; tokens: number; model: string }> {
  const s = await getAISettings();
  const key = await getKey(s.provider);
  if (!key) throw new AIError('no-key', `Add your ${PROVIDERS[s.provider].name} API key so Stacks can sort for you.`);

  const estimate = estimateCall(c);
  const used = await tokensToday();
  if (used + estimate > s.dailyTokenLimit) {
    const left = Math.max(0, s.dailyTokenLimit - used);
    throw new AIError('budget', `This needs about ${fmtNum(estimate)} tokens, but ${fmtNum(left)} are left of your daily limit. Raise the limit in Settings, or try again tomorrow.`);
  }

  const model = s.models[s.provider];
  let provider: Provider;
  try {
    provider = await ADAPTERS[s.provider]();
  } catch {
    throw new AIError('network', 'Could not load the AI module. Check your connection and reload the page.');
  }
  const res = await provider({ ...c, model, apiKey: key });
  await addTokens(res.tokens);
  try {
    return { json: JSON.parse(res.text), tokens: res.tokens, model: modelLabel(s.provider, model) };
  } catch {
    throw new AIError('bad-output', 'The AI sent back something Stacks could not read. Try again.');
  }
}
