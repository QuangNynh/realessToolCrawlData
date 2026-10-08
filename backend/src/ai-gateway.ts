import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import { AiStore, AiAccount } from './ai-store';
import { AiError, AiRequest, AiSnapshot, AiModel } from './ai-types';
import { antigravityConfig, antigravityMetadata } from './antigravity-config';
import { buildAntigravityRequest, completionOf, readAntigravitySse, responseDelta, unwrapAntigravity, usageOf } from './antigravity-format';
import { antigravityModels } from './antigravity-models';

type Json = Record<string, any>;
type Login = { state: string; verifier: string; redirectUri: string; server: Server; timer?: NodeJS.Timeout; controller: AbortController; exchanging: boolean };
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export class AiGateway {
  private store: AiStore;
  private login?: Login;
  private error?: string;
  private refreshing?: Promise<string>;
  private modelRefresh?: Promise<AiModel[]>;
  private legacyModelRefreshAttempted = false;
  constructor(directory: string, private fetcher: typeof fetch = fetch, private config = antigravityConfig) { this.store = new AiStore(directory); }

  snapshot(): AiSnapshot {
    const { account, keys, models, modelsUpdatedAt } = this.store.state;
    return { connected: Boolean(account), connecting: Boolean(this.login), email: account?.email, projectId: account?.projectId,
      error: this.error, models: structuredClone(models), modelsUpdatedAt, defaultModelId: this.store.state.defaultModelId, modelAliases: { ...this.store.state.modelAliases },
      keys: keys.map(({ hash: _hash, ...key }) => ({ ...key })) };
  }
  createKey(name: unknown) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new AiError('Tên key cần từ 1 đến 80 ký tự');
    if (this.store.state.keys.length >= 100) throw new AiError('Đã có 100 key. Thu hồi key không dùng trước khi tạo thêm');
    const key = `sk-crawldata-${randomBytes(32).toString('base64url')}`;
    const record = { id: randomUUID(), name: name.trim(), preview: `${key.slice(0, 16)}…${key.slice(-4)}`, hash: hashKey(key), createdAt: new Date().toISOString() };
    this.store.save({ ...this.store.state, keys: [...this.store.state.keys, record] });
    return { ...this.snapshot(), createdKey: { id: record.id, name: record.name, key } };
  }
  revokeKey(id: unknown) {
    if (typeof id !== 'string' || !this.store.state.keys.some(key => key.id === id)) throw new AiError('Không tìm thấy API key', 404);
    this.store.save({ ...this.store.state, keys: this.store.state.keys.filter(key => key.id !== id) });
    return this.snapshot();
  }
  authenticate(key: unknown) {
    if (typeof key !== 'string' || key.length > 256 || !key.startsWith('sk-crawldata-')) throw new AiError('API key không hợp lệ hoặc đã thu hồi', 401, 'invalid_api_key');
    const hash = hashKey(key);
    const record = this.store.state.keys.find(item => item.hash.length === hash.length && timingSafeEqual(Buffer.from(item.hash), Buffer.from(hash)));
    if (!record) throw new AiError('API key không hợp lệ hoặc đã thu hồi', 401, 'invalid_api_key');
    this.validateDesktopKey(record.id);
  }
  // Only trusted desktop IPC may select a stored key by ID. Public /v1 routes
  // still require the complete personal key through authenticate().
  validateDesktopKey(id: unknown) {
    const record = this.store.state.keys.find(item => item.id === id);
    if (!record) throw new AiError('API key không tồn tại hoặc đã thu hồi', 401, 'invalid_api_key');
    if (!record.lastUsedAt || Date.now() - Date.parse(record.lastUsedAt) > 60_000) {
      this.store.save({ ...this.store.state, keys: this.store.state.keys.map(item => item.id === record.id ? { ...item, lastUsedAt: new Date().toISOString() } : item) });
    }
  }

  async beginConnect() {
    if (this.login) throw new AiError('Đang chờ đăng nhập. Hoàn tất hoặc hủy kết nối hiện tại', 409);
    this.error = undefined;
    const server = createServer((request, response) => {
      const current = this.login;
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const state = url.searchParams.get('state') || '';
      if (request.method !== 'GET' || url.pathname !== '/oauth/callback' || !current || current.server !== server
        || state.length !== current.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(current.state))) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Phiên đăng nhập không hợp lệ.'); return;
      }
      if (current.exchanging) { response.writeHead(409); response.end('Đang hoàn tất đăng nhập.'); return; }
      current.exchanging = true;
      const code = url.searchParams.get('code');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      response.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>CrawlData</title><body style="font:18px system-ui;padding:48px"><h1>Quay lại CrawlData</h1><p>Ứng dụng đang hoàn tất kết nối Antigravity. Bạn có thể đóng cửa sổ này.</p></body></html>');
      void this.finishConnect(current, code, url.searchParams.get('error'));
    });
    const login: Login = { state: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), redirectUri: '', server, controller: new AbortController(), exchanging: false };
    this.login = login;
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      if (login.controller.signal.aborted) throw new AiError('Đã hủy đăng nhập');
      const address = server.address();
      if (!address || typeof address === 'string') throw new AiError('Không thể mở cổng nhận đăng nhập');
      login.redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      login.timer = setTimeout(() => { if (this.login === login) { this.error = 'Đăng nhập hết thời gian chờ. Bấm kết nối để thử lại'; this.cancelConnect(); } }, 300_000);
      login.timer.unref();
      const url = new URL(this.config.authorizeUrl);
      url.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', redirect_uri: login.redirectUri,
        scope: this.config.scopes.join(' '), state: login.state, access_type: 'offline', prompt: 'consent',
        code_challenge: createHash('sha256').update(login.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      return { ...this.snapshot(), authUrl: url.toString() };
    } catch (error) { this.cancelConnect(); throw error; }
  }
  cancelConnect() {
    const login = this.login;
    this.login = undefined;
    if (login) { clearTimeout(login.timer); login.controller.abort(); login.server.close(); login.server.closeAllConnections(); }
    return this.snapshot();
  }
  disconnect() {
    this.cancelConnect();
    this.store.save({ keys: this.store.state.keys, models: [] });
    this.error = undefined;
    return this.snapshot();
  }
  shutdown() { this.cancelConnect(); }

  private message(error: unknown) {
    let message = error instanceof Error ? error.message : 'Không thể kết nối Antigravity';
    for (const secret of [this.store.state.account?.accessToken, this.store.state.account?.refreshToken, this.config.clientSecret]) {
      if (secret) message = message.split(secret).join('[ẩn]');
    }
    return message.replace(/ya29\.[\w.-]+|1\/\/[^\s"<>]+|sk-crawldata-[\w-]+/g, '[ẩn]').slice(0, 1000);
  }
  private async readJson(response: Response): Promise<Json> {
    let data: Json;
    try { data = await response.json(); } catch { throw new AiError(`Máy chủ trả về dữ liệu không hợp lệ (HTTP ${response.status})`, 502, 'upstream_error'); }
    if (!response.ok) {
      const detail = typeof data.error === 'string' ? data.error_description || data.error : data.error?.message || `HTTP ${response.status}`;
      throw new AiError(this.message(new Error(detail)), response.status, response.status === 429 ? 'rate_limit_error' : 'upstream_error', response.headers.get('retry-after') || undefined);
    }
    return data;
  }
  private async tokenRequest(body: Record<string, string>, signal?: AbortSignal) {
    const response = await this.fetcher(this.config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...body }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    return this.readJson(response);
  }
  private headers(token: string) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': this.config.userAgent, 'x-request-source': 'local' }; }
  private async post(url: string, token: string, body: Json, signal?: AbortSignal, timeout = 30_000) {
    return this.fetcher(url, { method: 'POST', headers: this.headers(token), body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  }
  private async finishConnect(login: Login, code: string | null, error: string | null) {
    try {
      if (error || !code) throw new AiError('Bạn chưa cấp quyền đăng nhập Google. Bấm kết nối để thử lại');
      const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: login.redirectUri, code_verifier: login.verifier }, login.controller.signal);
      if (!tokens.access_token || !tokens.refresh_token) throw new AiError('Google chưa cấp đủ token. Đăng nhập lại và cấp quyền truy cập ngoại tuyến');
      const user = await this.readJson(await this.fetcher(this.config.userInfoUrl, { headers: this.headers(tokens.access_token), signal: AbortSignal.any([login.controller.signal, AbortSignal.timeout(30_000)]) }));
      const load = await this.readJson(await this.post(`${this.config.codeAssistUrl}/v1internal:loadCodeAssist`, tokens.access_token, { metadata: antigravityMetadata() }, login.controller.signal));
      let projectId = load.cloudaicompanionProject?.id || load.cloudaicompanionProject;
      if (!projectId) {
        const tierId = load.allowedTiers?.find((tier: Json) => tier.isDefault)?.id || 'legacy-tier';
        for (let i = 0; i < 10 && !projectId; i++) {
          const onboard = await this.readJson(await this.post(`${this.config.codeAssistUrl}/v1internal:onboardUser`, tokens.access_token, { tierId, metadata: antigravityMetadata() }, login.controller.signal));
          projectId = onboard.response?.cloudaicompanionProject?.id || onboard.response?.cloudaicompanionProject;
          if (!projectId && i < 9) await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new AiError('Đã hủy đăng nhập')); };
            const timer = setTimeout(() => { login.controller.signal.removeEventListener('abort', abort); resolve(); }, 5000);
            if (login.controller.signal.aborted) abort(); else login.controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
      if (typeof projectId !== 'string' || !projectId) throw new AiError('Tài khoản chưa có project Antigravity/Code Assist hợp lệ');
      if (this.login !== login || login.controller.signal.aborted) return;
      const account: AiAccount = { id: randomUUID(), accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000, email: user.email || '', projectId };
      this.store.save({ ...this.store.state, account, models: [], modelsUpdatedAt: undefined, modelAliases: undefined, defaultModelId: undefined });
      this.error = undefined;
      try { await this.models(true); }
      catch (error) { if (this.store.state.account === account) this.error = `Đã kết nối. Chưa lấy được model: ${this.message(error)}`; }
    } catch (error) { if (this.login === login && !login.controller.signal.aborted) this.error = this.message(error); }
    finally { if (this.login === login) this.cancelConnect(); }
  }
  private async accessToken(force = false): Promise<string> {
    const account = this.store.state.account;
    if (!account) throw new AiError('Hãy kết nối tài khoản Antigravity trong app trước', 503, 'provider_not_connected');
    if (!force && account.expiresAt > Date.now() + 60_000) return account.accessToken;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
        if (!tokens.access_token) throw new AiError('Google không trả về access token');
        if (this.store.state.account !== account) throw new AiError('Kết nối đã thay đổi. Thử lại yêu cầu', 409);
        this.store.save({ ...this.store.state, account: { ...account, accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || account.refreshToken, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 } });
        return tokens.access_token as string;
      } catch (error) {
        if (error instanceof AiError && [400, 401].includes(error.status)) throw new AiError('Phiên Google hết hạn hoặc bị thu hồi. Hãy kết nối lại Antigravity', 401, 'provider_auth_error');
        throw error;
      }
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async authorizedPost(url: string, body: Json, signal?: AbortSignal, timeout = 30_000) {
    const token = await this.accessToken();
    let response = await this.post(url, token, body, signal, timeout);
    if (response.status === 401) {
      await response.body?.cancel();
      const current = await this.accessToken();
      response = await this.post(url, current === token ? await this.accessToken(true) : current, body, signal, timeout);
    }
    return response;
  }
  async models(force = false): Promise<AiModel[]> {
    if (!this.store.state.account) throw new AiError('Hãy kết nối tài khoản Antigravity trước', 503, 'provider_not_connected');
    if (!force && this.store.state.modelAliases && this.store.state.models.length && Date.now() - Date.parse(this.store.state.modelsUpdatedAt || '') < 300_000) return structuredClone(this.store.state.models);
    if (this.modelRefresh) return this.modelRefresh;
    const projectId = this.store.state.account.projectId;
    const accountId = this.store.state.account.id;
    this.modelRefresh = (async () => {
      let response = await this.authorizedPost(`${this.config.baseUrl}/v1internal:fetchAvailableModels`, { project: projectId });
      if (response.status === 404) { await response.body?.cancel(); response = await this.authorizedPost(`${this.config.baseUrl}/v1internal:models`, { project: projectId }); }
      const data = await this.readJson(response);
      const catalog = antigravityModels(data);
      if (this.store.state.account?.id !== accountId) throw new AiError('Kết nối đã thay đổi. Thử lại', 409);
      this.store.save({ ...this.store.state, models: catalog.models, modelAliases: catalog.aliases, defaultModelId: catalog.defaultModelId, modelsUpdatedAt: new Date().toISOString() });
      this.error = undefined;
      return structuredClone(catalog.models);
    })().finally(() => { this.modelRefresh = undefined; });
    return this.modelRefresh;
  }

  async generate(body: Json, signal?: AbortSignal): Promise<{ response: Response; model: string; streaming: boolean }> {
    const rawModel = body?.model;
    if (typeof rawModel !== 'string' || !/^(?:ag\/)?[\w.():-]{1,180}$/.test(rawModel)) throw new AiError('Cần tên model hợp lệ từ GET /v1/models');
    const requestedModel = rawModel.startsWith('ag/') ? rawModel : `ag/${rawModel}`;
    let models = await this.models();
    let model = this.store.state.modelAliases?.[requestedModel] || requestedModel;
    if (!models.some(item => item.id === model)) {
      models = await this.models(true);
      model = this.store.state.modelAliases?.[requestedModel] || requestedModel;
    }
    if (!models.some(item => item.id === model)) throw new AiError('Model không có trong danh sách Antigravity của tài khoản này', 404, 'model_not_found');
    const payload = buildAntigravityRequest(body, model.slice(3), this.store.state.account!.projectId);
    const streaming = body.stream === true && !/image|imagen/i.test(model);
    const action = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const startedAt = Date.now();
    console.info(`[AI] POST ${action} model=${model}${model !== requestedModel ? ` alias=${requestedModel}` : ''}`);
    const response = await this.authorizedPost(`${this.config.baseUrl}/v1internal:${action}`, payload, signal, 180_000);
    console.info(`[AI] HTTP ${response.status} model=${model} duration=${Date.now() - startedAt}ms`);
    if (!response.ok) {
      try { await this.readJson(response); }
      catch (error) { if (error instanceof AiError) throw new AiError(`Antigravity · ${model} · HTTP ${error.status}: ${error.message}`, error.status, error.code, error.retryAfter); throw error; }
    }
    return { response, model, streaming };
  }
  async chat(key: unknown, body: Json, signal?: AbortSignal) {
    this.authenticate(key);
    return this.desktopCompletion(body, signal);
  }
  async desktopChat(keyId: string, body: Json, signal?: AbortSignal) {
    this.validateDesktopKey(keyId);
    return this.desktopCompletion(body, signal);
  }
  private async desktopCompletion(body: Json, signal?: AbortSignal) {
    const { response, model } = await this.generate({ ...body, stream: false }, signal);
    return completionOf(await this.readJson(response), model);
  }
  async *stream(response: Response, model: string) {
    if (!response.body) throw new AiError('Antigravity không trả về stream', 502, 'upstream_error');
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta: Json, finish: string | null = null, usage?: Json) => ({ id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
    yield chunk({ role: 'assistant', content: '' });
    let toolOffset = 0;
    let seen = false;
    let finish = 'stop';
    let usage: Json | undefined;
    for await (const raw of readAntigravitySse(response.body)) {
      if (raw.error) throw new AiError(this.message(new Error(raw.error.message || 'Lỗi stream Antigravity')), 502, 'upstream_error');
      const value = unwrapAntigravity(raw);
      const { delta, finishReason, toolCount } = responseDelta(value, toolOffset);
      toolOffset += toolCount;
      if (value.candidates?.length) seen = true;
      if (value.usageMetadata) usage = usageOf(value);
      if (finishReason) finish = finishReason;
      if (Object.keys(delta).length) yield chunk(delta);
    }
    if (!seen) throw new AiError('Antigravity trả về stream rỗng', 502, 'upstream_error');
    yield chunk({}, toolOffset ? 'tool_calls' : finish, usage);
  }
  async dispatch(request: AiRequest) {
    switch (request?.action) {
      case 'status':
        // Refresh legacy caches once: old releases saved every catalog entry,
        // including IDs that Google explicitly retired.
        if (this.store.state.account && !this.store.state.modelAliases && !this.legacyModelRefreshAttempted) {
          this.legacyModelRefreshAttempted = true;
          try { await this.models(); } catch (error) { this.error = this.message(error); }
        }
        return this.snapshot();
      case 'connect': return this.beginConnect();
      case 'cancel-connect': return this.cancelConnect();
      case 'disconnect': return this.disconnect();
      case 'refresh-models': await this.models(true); return this.snapshot();
      case 'create-key': return this.createKey(request.name);
      case 'revoke-key': return this.revokeKey(request.id);
      case 'chat': {
        if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 100_000) throw new AiError('Nhập nội dung từ 1 đến 100.000 ký tự');
        return this.chat(request.apiKey, { model: request.model, messages: [{ role: 'user', content: request.prompt }] });
      }
      default: throw new AiError('Thao tác AI không hợp lệ');
    }
  }
}
