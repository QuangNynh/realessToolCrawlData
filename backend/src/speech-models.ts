// Fallback choices before Moonshine is installed; the installed SDK supplies its catalog.
export type SpeechEngine = 'whisper' | 'moonshine';
export const moonshineModels = ['tiny-streaming', 'small-streaming', 'medium-streaming'] as const;
export type MoonshineModel = typeof moonshineModels[number];
export type SpeechModel = 'tiny' | 'base' | 'small' | MoonshineModel;
export type SpeechLanguage = 'auto' | 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ar' | 'tl';
export type MoonshineModelCatalog = Partial<Record<SpeechLanguage, MoonshineModel[]>>;
export const speechLanguages: Record<SpeechLanguage, string> = {
  auto: 'Tự nhận dạng', vi: 'Tiếng Việt', en: 'Tiếng Anh', zh: 'Tiếng Trung', ja: 'Tiếng Nhật',
  ko: 'Tiếng Hàn', fr: 'Tiếng Pháp', de: 'Tiếng Đức', es: 'Tiếng Tây Ban Nha', ar: 'Tiếng Ả Rập', tl: 'Tiếng Tagalog',
};
export const whisperLanguages: SpeechLanguage[] = ['auto', 'vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'];
// Use the current streaming models. Each requires an explicit audio language.
export const moonshineLanguages: SpeechLanguage[] = ['vi', 'en', 'zh', 'ja', 'de', 'es', 'ar', 'tl'];
const fallbackMoonshineModels: MoonshineModelCatalog = {
  vi: ['tiny-streaming'], en: [...moonshineModels], zh: ['tiny-streaming'],
  ja: ['tiny-streaming', 'small-streaming'], de: ['tiny-streaming', 'small-streaming'],
  es: ['tiny-streaming', 'small-streaming'], ar: ['tiny-streaming'], tl: ['tiny-streaming'],
};
export const speechModelNames: Record<SpeechModel, string> = {
  tiny: 'Tiny · nhanh', base: 'Base · cân bằng', small: 'Small · chính xác hơn, chậm hơn',
  'tiny-streaming': 'Tiny Streaming · nhanh, nhẹ', 'small-streaming': 'Small Streaming · cân bằng',
  'medium-streaming': 'Medium Streaming · chính xác hơn, dùng nhiều RAM',
};
export function modelsForSpeech(engine: SpeechEngine, language: SpeechLanguage, catalog = fallbackMoonshineModels): SpeechModel[] {
  if (engine === 'whisper') return ['tiny', 'base', 'small'];
  return [...(catalog[language] || [])];
}
export function selectableSpeechModels(engine: SpeechEngine, language: SpeechLanguage, catalog?: MoonshineModelCatalog): SpeechModel[] {
  return modelsForSpeech(engine, language, catalog).filter(model => engine !== 'moonshine' || model !== 'tiny-streaming');
}
export function languagesForSpeech(engine: SpeechEngine, catalog = fallbackMoonshineModels): SpeechLanguage[] {
  return engine === 'whisper' ? [...whisperLanguages] : moonshineLanguages.filter(language => catalog[language]?.length);
}
// Moonshine offers English only; Whisper also offers Vietnamese. Keep the full
// SDK catalog for reading saved jobs with their original options.
export function selectableSpeechLanguages(engine: SpeechEngine, catalog?: MoonshineModelCatalog): SpeechLanguage[] {
  const supported = languagesForSpeech(engine, catalog);
  const choices: SpeechLanguage[] = engine === 'moonshine' ? ['en'] : ['en', 'vi'];
  return choices.filter(language => supported.includes(language));
}
