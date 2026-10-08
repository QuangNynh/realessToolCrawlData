export interface AiModel { id: string; name: string; kind: 'chat' | 'image' }
export interface AiKey { id: string; name: string; preview: string; createdAt: string; lastUsedAt?: string }
export interface AiSnapshot {
  baseUrl?: string;
  connected: boolean;
  connecting: boolean;
  email?: string;
  projectId?: string;
  error?: string;
  models: AiModel[];
  defaultModelId?: string;
  modelAliases?: Record<string, string>;
  modelsUpdatedAt?: string;
  keys: AiKey[];
}
export type AiAction = 'status' | 'connect' | 'cancel-connect' | 'disconnect' | 'refresh-models' | 'create-key' | 'revoke-key' | 'chat';
export interface AiRequest { action: AiAction; name?: string; id?: string; apiKey?: string; model?: string; prompt?: string }
export class AiError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid_request_error', public retryAfter?: string) { super(message); }
}
