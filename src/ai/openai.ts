import OpenAI from 'openai';
import { AIError } from './errors';
import type { Provider } from './providers';

/* ---- OpenAI ---- */

export const openaiProvider: Provider = async (req) => {
  const client = new OpenAI({ apiKey: req.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  let res: OpenAI.Chat.Completions.ChatCompletion;
  try {
    res = await client.chat.completions.create({
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
      max_completion_tokens: req.maxTokens,
    });
  } catch (err) {
    throw mapOpenAIError(err);
  }
  const choice = res.choices[0];
  if (!choice) throw new AIError('bad-output', 'OpenAI sent back an empty reply. Try again.');
  if (choice.message.refusal) throw new AIError('refused', `OpenAI declined: ${choice.message.refusal}`);
  if (choice.finish_reason === 'length') throw new AIError('truncated', 'The reply was cut off. Try sending fewer items at once.');
  return { text: choice.message.content ?? '', tokens: res.usage?.total_tokens ?? 0 };
};

function mapOpenAIError(err: unknown): AIError {
  if (err instanceof OpenAI.AuthenticationError) return new AIError('bad-key', 'OpenAI did not accept this API key. Check it in Settings.');
  if (err instanceof OpenAI.PermissionDeniedError) return new AIError('bad-key', 'This API key is not allowed to use that model.');
  if (err instanceof OpenAI.NotFoundError) return new AIError('model', 'OpenAI does not know that model name. Pick another model in Settings.');
  if (err instanceof OpenAI.RateLimitError) {
    if (err.code === 'insufficient_quota') return new AIError('no-credit', 'Your OpenAI account is out of credit. Add credit in the OpenAI dashboard, or use another key.');
    return new AIError('rate-limit', 'OpenAI is rate-limiting this key. Wait a minute and try again.');
  }
  if (err instanceof OpenAI.BadRequestError) return new AIError('other', `OpenAI rejected the request: ${err.message}`);
  if (err instanceof OpenAI.APIConnectionError) return new AIError('network', 'Could not reach OpenAI. Check your internet connection.');
  if (err instanceof OpenAI.APIError) return new AIError('other', `OpenAI returned an error: ${err.message}`);
  return new AIError('other', err instanceof Error ? err.message : 'Something went wrong talking to OpenAI.');
}
