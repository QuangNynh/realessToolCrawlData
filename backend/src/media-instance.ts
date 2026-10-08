import path from 'node:path';
import { DATA_DIR } from './config';
import { MediaJobs } from './media-jobs';
let media: MediaJobs | undefined;
export const getMediaJobs = () => media || (media = new MediaJobs(path.join(DATA_DIR, 'media-jobs')));
export const shutdownMediaJobs = () => media?.shutdown();
