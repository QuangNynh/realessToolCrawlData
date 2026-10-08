import express from 'express';
import { once } from 'node:events';
import { AiGateway } from './ai-gateway';
import { AiError } from './ai-types';
import { completionOf } from './antigravity-format';

export function aiErrorResponse(error: unknown) {
  const failure = error instanceof AiError ? error : new AiError('Không thể xử lý yêu cầu AI. Kiểm tra kết nối và thử lại', 502, 'upstream_error');
  return { status: failure.status, retryAfter: failure.retryAfter,
    body: { error: { message: failure.message, type: failure.code, code: failure.code, param: null } } };
}
export function mountAiRoutes(app: express.Express, getGateway: () => AiGateway) {
  app.post('/api/v1/internal/ai', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') || req.headers.origin) return res.sendStatus(403);
    try { return res.json(await getGateway().dispatch(req.body)); }
    catch (error) {
      const failure = aiErrorResponse(error);
      return res.status(failure.status).json({ message: failure.body.error.message });
    }
  });
  const router = express.Router();
  router.use((req, res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') || '');
      getGateway().authenticate(match?.[1]);
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) { const failure = aiErrorResponse(error); res.status(failure.status).json(failure.body); }
  });
  router.get('/models', async (_req, res) => {
    try {
      const models = await getGateway().models();
      return res.json({ object: 'list', data: models.map(model => ({ id: model.id, object: 'model', created: 0, owned_by: 'antigravity', name: model.name })) });
    } catch (error) { const failure = aiErrorResponse(error); return res.status(failure.status).json(failure.body); }
  });
  router.post('/chat/completions', async (req, res) => {
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      if (JSON.stringify(req.body || {}).length > 8 * 1024 * 1024) throw new AiError('Nội dung yêu cầu vượt quá 8 MB', 413);
      const gateway = getGateway();
      const { response, model, streaming } = await gateway.generate(req.body, controller.signal);
      if (controller.signal.aborted) { await response.body?.cancel(); return; }
      if (!req.body.stream) return res.json(completionOf(await response.json(), model));
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      const write = async (value: unknown) => {
        if (controller.signal.aborted) throw new AiError('Yêu cầu đã hủy');
        if (!res.write(`data: ${JSON.stringify(value)}\n\n`)) await once(res, 'drain', { signal: controller.signal });
      };
      if (streaming) {
        for await (const chunk of gateway.stream(response, model)) await write(chunk);
      } else {
        // Image models return JSON even when the client requests streaming.
        // Convert that completed response into the same chat chunk protocol.
        const result = completionOf(await response.json(), model);
        await write({ id: result.id, object: 'chat.completion.chunk', created: result.created, model,
          choices: [{ index: 0, delta: result.choices[0].message, finish_reason: null }] });
        await write({ id: result.id, object: 'chat.completion.chunk', created: result.created, model,
          choices: [{ index: 0, delta: {}, finish_reason: result.choices[0].finish_reason }], usage: result.usage });
      }
      res.end('data: [DONE]\n\n');
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = aiErrorResponse(error);
      if (res.headersSent) res.end(`data: ${JSON.stringify(failure.body)}\n\ndata: [DONE]\n\n`);
      else { if (failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter); res.status(failure.status).json(failure.body); }
    } finally { res.removeListener('close', onClose); }
  });
  router.use((_req, res) => res.status(404).json({ error: { message: 'Endpoint AI không tồn tại', type: 'invalid_request_error', code: 'not_found' } }));
  app.use('/v1', router);
}
