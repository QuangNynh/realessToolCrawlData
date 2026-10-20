export interface ApiConnection {
  usePublic: boolean;
  domain: string;
  localPort: string;
}
const key = 'crawldata.api-connection.v1';
export const defaultConnection: ApiConnection = {
  usePublic: false, domain: '', localPort: import.meta.env.DEV ? '8695' : '8696',
};
const validatePort = (value: string) => {
  if (!/^\d+$/.test(value) || +value < 1 || +value > 65535) throw new Error('Port phải từ 1 đến 65535.');
};
export function connectionUrl(config: ApiConnection): string {
  if (!config.usePublic) {
    validatePort(config.localPort);
    return `http://127.0.0.1:${Number(config.localPort)}/api/v1/`;
  }
  const domain = config.domain.trim();
  if (!domain) throw new Error('Nhập domain API public trước khi bật.');
  const url = new URL(domain.includes('://') ? domain : `https://${domain}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('Domain phải là địa chỉ HTTP/HTTPS, không chứa tài khoản, query hoặc hash.');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/health$/, '');
  url.pathname = path.endsWith('/api/v1') ? path + '/' : path + '/api/v1/';
  return url.toString();
}
export function loadConnection(): ApiConnection {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (!data) return { ...defaultConnection };
    const config: ApiConnection = {
      usePublic: data.usePublic ?? defaultConnection.usePublic,
      domain: data.domain ?? defaultConnection.domain,
      localPort: data.localPort ?? defaultConnection.localPort,
    };
    // Preserve the address saved by the previous separate-port form.
    if (typeof data.publicPort === 'string' && data.publicPort.trim() && typeof config.domain === 'string' && config.domain.trim()) {
      validatePort(data.publicPort.trim());
      const url = new URL(config.domain.includes('://') ? config.domain : `https://${config.domain}`);
      if (!url.port) url.port = data.publicPort.trim();
      config.domain = url.toString();
    }
    if (typeof config.usePublic !== 'boolean' || ['domain', 'localPort'].some(field => typeof config[field as keyof ApiConnection] !== 'string')) return { ...defaultConnection };
    connectionUrl(config);
    return config;
  } catch { return { ...defaultConnection }; }
}
export function saveConnection(config: ApiConnection) {
  connectionUrl(config);
  localStorage.setItem(key, JSON.stringify(config));
  window.dispatchEvent(new Event('api-connection-changed'));
}
export const apiBaseUrl = () => connectionUrl(loadConnection());
