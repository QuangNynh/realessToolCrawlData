export interface OcrItem { name: string; status: 'pending' | 'processing' | 'completed' | 'failed'; text?: string; error?: string; attempts: number }
export interface OcrJob { id: string; folder: string; model: string; keyId: string; output: string; status: 'running' | 'paused' | 'completed' | 'failed'; error?: string; items: OcrItem[] }
export interface OcrSnapshot { job: OcrJob | null; working?: boolean }
export type OcrRequest = { action: 'get' | 'pause' | 'resume' | 'retry' | 'reveal' | 'text' | 'reset' | 'download'; model?: string; keyId?: string } | { action: 'create'; folderId: string; model: string; keyId: string };
