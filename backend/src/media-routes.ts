import type express from 'express';
import type { MediaJobs } from './media-jobs';
export function mountMediaRoutes(app: express.Express, getMedia: () => MediaJobs) {
  app.post('/api/v1/internal/media', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') || req.headers.origin) return res.sendStatus(403);
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json(await getMedia().dispatch(req.body)); }
    catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : String(error) }); }
  });
}
