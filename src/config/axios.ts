import axios from 'axios';

const BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8695/api/v1/'
  : 'http://127.0.0.1:8696/api/v1/';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 600000, // 10 minutes for large downloads
});

export default api;
