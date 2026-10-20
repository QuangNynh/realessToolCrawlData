import axios from 'axios';

import { apiBaseUrl } from './api-connection';

/** Default timeout for metadata / JSON requests (30 seconds) */
export const TIMEOUT_METADATA = 30_000;

/** Timeout for file downloads (10 minutes) */
export const TIMEOUT_DOWNLOAD = 600_000;

/** Timeout for channel scanning / heavy operations (3 minutes) */
export const TIMEOUT_SCAN = 180_000;

const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: TIMEOUT_METADATA,
});

// Resolve the selected endpoint for every request, including existing services.
api.interceptors.request.use(config => {
  config.baseURL = apiBaseUrl();
  return config;
});

export default api;
