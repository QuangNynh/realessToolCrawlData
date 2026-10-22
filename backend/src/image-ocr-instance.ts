import path from 'node:path';
import { DATA_DIR } from './config';
import { getAiGateway } from './ai-instance';
import { ImageOcr } from './image-ocr';
let current: ImageOcr | undefined;
export const getImageOcr = () => current || (current = new ImageOcr(path.join(DATA_DIR, 'image-ocr'), getAiGateway));
export const shutdownImageOcr = () => current?.shutdown();
export function dispatchImageOcr(input: any) {
  const service = getImageOcr();
  switch (input?.action) {
    case 'get': return service.snapshot();
    case 'reset': return service.reset();
    case 'text': return service.text();
    case 'create': return service.create(input.folder, input.directory, input.model, input.keyId);
    case 'pause': case 'resume': case 'retry': return service.control(input.action, input.model, input.keyId);
    case 'export': return service.exportText(input.filename, input.id);
    case 'output': return { output: service.output() };
    default: throw new Error('Thao tác đọc ảnh không hợp lệ');
  }
}
