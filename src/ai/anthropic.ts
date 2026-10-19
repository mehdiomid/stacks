import Anthropic from '@anthropic-ai/sdk';
import { AIError } from './errors';
import type { Provider } from './providers';

/* ---- Anthropic (Claude) ----
 * The browser calls api.anthropic.com directly with the user's own key; the Stacks server never sees it.
 * Sonnet 5.5 and Opus 5.5 get server-side refusal fallbacks; Haiku 5.5 has none.
 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export const anthropicProvider: Provider = async (req) => {
  const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const base = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user' as const, content: req.user }],
    // Sorting is simple work: low effort keeps thinking (and cost) small.
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: req.schema } },
  };
  let res: { content: { type: string; text?: string }[]; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } };
  try {
    res = FALLBACK_MODELS.has(req.model)
      ? await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
      : await client.messages.create(base as unknown as Anthropic.MessageCreateParamsNonStreaming);
  } catch (err) {
    throw mapAnthropicError(err);
  }
  if (res.stop_reason === 'refusal') throw new AIError('refused', 'The AI declined to handle this text. Try removing the part it may have objected to.');
  if (res.stop_reason === 'max_tokens') throw new AIError('truncated', 'The reply was cut off. Try sending fewer items at once.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return { text, tokens: res.usage.input_tokens + res.usage.output_tokens };
};

function mapAnthropicError(err: unknown): AIError {
  if (err instanceof Anthropic.AuthenticationError) return new AIError('bad-key', 'Claude did not accept this API key. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AIError('bad-key', 'This API key is not allowed to use that model.');
  if (err instanceof Anthropic.NotFoundError) return new AIError('model', 'Claude does not know that model name. Pick another model in Settings.');
  if (err instanceof Anthropic.RateLimitError) return new AIError('rate-limit', 'Claude is rate-limiting this key. Wait a minute and try again.');
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return new AIError('no-credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic Console, or use another key.');
    return new AIError('other', `Claude rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AIError('network', 'Could not reach Claude. Check your internet connection.');
  if (err instanceof Anthropic.APIError) return new AIError('other', `Claude returned an error: ${err.message}`);
  return new AIError('other', err instanceof Error ? err.message : 'Something went wrong talking to Claude.');
}
