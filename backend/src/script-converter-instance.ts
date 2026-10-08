import path from 'node:path';
import { DATA_DIR } from './config';
import { getAiGateway } from './ai-instance';
import { ScriptConverter } from './script-converter';
let converter: ScriptConverter | undefined;
export const getScriptConverter = () => converter || (converter = new ScriptConverter(path.join(DATA_DIR, 'script-converter'), getAiGateway));
export const shutdownScriptConverter = () => converter?.shutdown();
