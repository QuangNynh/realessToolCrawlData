import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AiKey, AiModel } from './ai-types';

export interface AiAccount { id: string; accessToken: string; refreshToken: string; expiresAt: number; email: string; projectId: string }
export interface AiState {
  account?: AiAccount; keys: (AiKey & { hash: string })[]; models: AiModel[]; modelsUpdatedAt?: string;
  modelAliases?: Record<string, string>; defaultModelId?: string;
}

// Account tokens stay in the backend. The store and its local encryption key
// are owner-readable only; API keys are stored as SHA-256 hashes, never plaintext.
export class AiStore {
  private readonly file: string;
  private readonly key: Buffer;
  state: AiState;
  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'state.enc');
    const keyFile = path.join(directory, 'encryption.key');
    try { fs.writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.key = fs.readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Khóa lưu trữ AI không hợp lệ');
    if (fs.existsSync(this.file)) {
      const data = fs.readFileSync(this.file);
      try {
        if (data.length < 29 || data[0] !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(1, 13));
        decipher.setAuthTag(data.subarray(13, 29));
        const state = JSON.parse(Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8'));
        if (!Array.isArray(state.keys) || !Array.isArray(state.models)) throw new Error();
        this.state = state;
      } catch { throw new Error('Không thể đọc dữ liệu AI đã lưu. Kiểm tra file state.enc và encryption.key'); }
    } else this.state = { keys: [], models: [] };
  }
  save(next: AiState) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()]);
    const temporary = this.file + '.tmp';
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(descriptor, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, this.file);
    this.state = next;
  }
}
