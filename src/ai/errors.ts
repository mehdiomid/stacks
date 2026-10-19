export type AIErrorCode = 'no-key' | 'bad-key' | 'no-credit' | 'budget' | 'rate-limit' | 'network' | 'refused' | 'truncated' | 'bad-output' | 'model' | 'other';

export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string) {
    super(message);
  }
  /** These are fixed in Settings, so the app opens Settings for them. */
  get needsSettings(): boolean {
    return this.code === 'no-key' || this.code === 'bad-key' || this.code === 'no-credit' || this.code === 'budget' || this.code === 'model';
  }
}
