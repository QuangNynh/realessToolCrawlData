import axios from 'axios';

const BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8695/api/v1/'
  : 'http://127.0.0.1:8696/api/v1/';

/** Default timeout for metadata / JSON requests (30 seconds) */
export const TIMEOUT_METADATA = 30_000;

/** Timeout for file downloads (10 minutes) */
export const TIMEOUT_DOWNLOAD = 600_000;

/** Timeout for channel scanning / heavy operations (3 minutes) */
export const TIMEOUT_SCAN = 180_000;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_METADATA,
});

export default api;
