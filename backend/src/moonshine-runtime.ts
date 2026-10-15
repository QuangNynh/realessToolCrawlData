import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareSpeechPython, pythonEnvironmentBinary, runMediaProcess } from './media-runtime';
import type { MoonshineRuntimeStatus } from './media-types';
import { moonshineLanguages, moonshineModels, type MoonshineModelCatalog } from './speech-models';
import { assertNativeSpeechBinary } from './native-architecture';

export const MOONSHINE_PACKAGE = 'moonshine-voice==0.1.5';
const catalogMarker = 'LENYT_MOONSHINE_MODELS=';
const checkCode = `
import json
import platform
import sys
if sys.platform == "darwin" and platform.machine() != "arm64":
    raise RuntimeError("Moonshine requires native arm64 Python, not Rosetta")
from importlib.metadata import version
from moonshine_voice import Transcriber, ModelArch, get_model_for_language
from moonshine_voice.download import find_model_info, supported_languages
from moonshine_voice.moonshine_api import _MoonshineLib
assert version("moonshine-voice") == "0.1.5"
_MoonshineLib()
architectures = {
    "tiny-streaming": ModelArch.TINY_STREAMING,
    "small-streaming": ModelArch.SMALL_STREAMING,
    "medium-streaming": ModelArch.MEDIUM_STREAMING,
}
catalog = {}
supported = set(supported_languages())
for language in ${JSON.stringify(moonshineLanguages)}:
    if language not in supported:
        continue
    models = []
    for name, arch in architectures.items():
        try:
            find_model_info(language, arch)
        except ValueError:
            continue
        models.append(name)
    if models:
        catalog[language] = models
print("${catalogMarker}" + json.dumps(catalog), flush=True)
`;

export class MoonshineRuntime {
  private state: MoonshineRuntimeStatus = { ready: false, checking: false, installing: false, message: 'Chưa kiểm tra Moonshine.' };
  private check?: Promise<void>;
  private controller?: AbortController;
  constructor(readonly directory: string) {}
  private python() { return pythonEnvironmentBinary(path.join(this.directory, 'venv')); }
  status(): MoonshineRuntimeStatus { return structuredClone(this.state); }
  private async readModels(python: string, signal: AbortSignal) {
    // Resolving the native catalog is local and does not download model weights.
    assertNativeSpeechBinary(python);
    const output = await runMediaProcess(python, ['-X', 'utf8', '-c', checkCode], signal, undefined, 30_000);
    const record = output.split(/\r?\n/).find(line => line.startsWith(catalogMarker));
    if (!record) throw new Error('Moonshine không trả về danh sách model.');
    const raw = JSON.parse(record.slice(catalogMarker.length));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Danh sách model Moonshine không hợp lệ.');
    const models: MoonshineModelCatalog = {};
    for (const language of moonshineLanguages) {
      const available = raw[language];
      if (Array.isArray(available)) {
        const known = moonshineModels.filter(model => available.includes(model));
        if (known.length) models[language] = known;
      }
    }
    if (!Object.keys(models).length) throw new Error('Moonshine không có model streaming được hỗ trợ.');
    return models;
  }
  private platformError() {
    if (process.platform === 'darwin' && (process.arch !== 'arm64' || Number(os.release().split('.')[0]) < 24)) return 'Moonshine 0.1.5 cần macOS 15 trở lên trên Apple Silicon. Hãy dùng Whisper trên máy Mac này.';
    if (process.platform === 'win32' && process.arch !== 'x64') return 'Moonshine 0.1.5 cần Windows x64.';
    return '';
  }
  async refresh() {
    if (this.state.installing) return;
    if (!this.check) this.check = this.discover().finally(() => { this.check = undefined; });
    await this.check;
  }
  private async discover() {
    this.state.checking = true;
    let message = this.platformError();
    const python = this.python();
    if (!message && fs.existsSync(python)) {
      try {
        const models = await this.readModels(python, AbortSignal.timeout(30_000));
        this.state = { ready: true, checking: false, installing: false, message: 'Moonshine sẵn sàng · đã cập nhật danh sách model', executable: python, models };
        return;
      } catch { message = 'Không kiểm tra được Moonshine hoặc danh sách model. Bấm Kiểm tra lại hoặc Cài / sửa Moonshine để cài lại môi trường riêng.'; }
    }
    this.state = { ready: false, checking: false, installing: false, message: message || 'Bấm Cài / sửa Moonshine để cài môi trường riêng (cần Python 3 64-bit và internet).' };
  }
  async executable() {
    if (!this.state.ready) await this.refresh();
    if (!this.state.ready || !this.state.executable) throw new Error(this.state.message);
    return this.state.executable;
  }
  install() {
    if (this.state.installing) return this.status();
    const unsupported = this.platformError();
    if (unsupported) { this.state = { ready: false, checking: false, installing: false, message: unsupported }; return this.status(); }
    this.controller = new AbortController();
    this.state = { ready: false, checking: false, installing: true, message: 'Đang tìm Python 3 cho Moonshine…' };
    void this.setup(this.controller.signal).catch(error => {
      this.state = { ready: false, checking: false, installing: false, message: `Cài Moonshine thất bại: ${(error instanceof Error ? error.message : String(error)).slice(-1200)}` };
    });
    return this.status();
  }
  private async setup(signal: AbortSignal) {
    await this.check;
    this.state = { ready: false, checking: false, installing: true, message: 'Đang tìm Python 3 cho Moonshine…' };
    const python = await prepareSpeechPython(path.join(this.directory, 'venv'), signal, stage => { this.state.message = stage; }, 'Moonshine');
    this.state.message = 'Đang tải và cài Moonshine…';
    await runMediaProcess(python, ['-X', 'utf8', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--use-deprecated=legacy-certs', '--no-input', MOONSHINE_PACKAGE], signal, undefined, 15 * 60_000);
    this.state.message = 'Đang đọc danh sách model Moonshine…';
    const models = await this.readModels(python, signal);
    this.state = { ready: true, checking: false, installing: false, message: 'Moonshine sẵn sàng · đã cài và cập nhật danh sách model', executable: python, models };
  }
  modelDirectory() { return path.join(this.directory, 'models'); }
  shutdown() { this.controller?.abort(); }
}
