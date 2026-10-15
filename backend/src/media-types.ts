import type { MoonshineModelCatalog, SpeechEngine, SpeechLanguage, SpeechModel } from './speech-models';
import type { SrtTiming } from './subtitle-timing';

export type MediaTool = 'srt' | 'script' | 'extract';
export type MediaStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AudioFormat = 'mp3' | 'wav' | 'aac' | 'flac' | 'ogg';
export interface MediaOptions {
  engine: SpeechEngine;
  model: SpeechModel;
  language: SpeechLanguage;
  format: AudioFormat;
  bitrate: '64' | '128' | '192' | '256' | '320';
  srtTiming: SrtTiming;
  srtGapMs: number;
}
export interface MediaItem {
  id: string;
  name: string;
  bytes: number;
  status: MediaStatus;
  stage?: string;
  progress?: number;
  output?: string;
  error?: string;
}
export interface MediaJob {
  id: string;
  tool: MediaTool;
  createdAt: string;
  directory: string;
  options: MediaOptions;
  paused: boolean;
  items: MediaItem[];
}
export interface MediaRuntimeStatus {
  ready: boolean;
  checking: boolean;
  installing: boolean;
  message: string;
  executable?: string;
}
export interface MoonshineRuntimeStatus extends MediaRuntimeStatus { models?: MoonshineModelCatalog }
export interface MediaSnapshot { jobs: MediaJob[]; runtime: MediaRuntimeStatus; moonshineRuntime: MoonshineRuntimeStatus }
export interface SelectedMediaFile { id: string; name: string; bytes: number }
export type MediaRequest =
  | { action: 'list' | 'runtime' | 'install-whisper' | 'install-moonshine'; engine?: SpeechEngine }
  | { action: 'create'; tool: MediaTool; fileIds: string[]; options: Partial<MediaOptions> }
  | { action: 'pause' | 'resume' | 'retry' | 'cancel'; id: string }
  | { action: 'clear' | 'reset'; tool: MediaTool }
  | { action: 'preview' | 'reveal'; id: string; itemId: string }
  | { action: 'export'; id: string; kind: 'txt' | 'zip' };
