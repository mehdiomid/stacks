export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON Schema the reply must follow. Every object has additionalProperties: false. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  model: string;
  apiKey: string;
}

export interface CompletionResult {
  text: string;
  tokens: number;
}

/** One adapter per provider. The rest of the app only sees this shape. */
export type Provider = (req: CompletionRequest) => Promise<CompletionResult>;
