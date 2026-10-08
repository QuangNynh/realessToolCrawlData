export interface ScriptInput { id: string; indexText: string; link: string; title: string; content: string }
export interface ConvertedScript extends ScriptInput {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number; result?: string; error?: string;
}
export interface ScriptJobSummary {
  id: string; name: string; model: string; keyId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  createdAt: string; updatedAt: string; revision: number;
  total: number; completed: number; failed: number; currentId?: string;
  retryAt?: string; error?: string;
}
export interface ScriptJob extends ScriptJobSummary { prompt: string; scripts: ConvertedScript[] }
export interface ScriptSnapshot { jobs: ScriptJobSummary[] }
export interface ScriptRequest {
  action: 'list' | 'parse' | 'create' | 'get' | 'pause' | 'resume' | 'delete' | 'export';
  id?: string; rawText?: string; mode?: 'batch' | 'single'; name?: string;
  model?: string; keyId?: string; prompt?: string; format?: 'txt' | 'doc';
}
