import path from 'node:path';
import { DATA_DIR } from './config';
import { AiGateway } from './ai-gateway';
let gateway: AiGateway | undefined;
export const getAiGateway = () => gateway || (gateway = new AiGateway(path.join(DATA_DIR, 'ai-gateway')));
export const shutdownAiGateway = () => gateway?.shutdown();
