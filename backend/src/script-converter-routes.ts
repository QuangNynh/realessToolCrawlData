import type express from 'express';
import type { ScriptConverter } from './script-converter';
import { aiErrorResponse } from './ai-routes';
export function mountScriptConverterRoutes(app: express.Express, getConverter: () => ScriptConverter) {
  app.post('/api/v1/internal/script-converter', (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') || req.headers.origin) return res.sendStatus(403);
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json(getConverter().dispatch(req.body)); }
    catch (error) { const failure = aiErrorResponse(error); return res.status(failure.status).json({ message: failure.body.error.message }); }
  });
}
