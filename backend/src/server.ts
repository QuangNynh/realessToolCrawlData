import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { loadSettings } from './config';
import { apiRouter } from './routes';
import { instagramService } from './instagram.service';

export function createServer() {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy']) {
    delete process.env[key];
  }
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
  axios.defaults.proxy = false;

  const app = express();

  app.use(cors({ exposedHeaders: ['Content-Disposition', 'Content-Length'] }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.post('/api/v1/internal/instagram-session', (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') || req.headers.origin) {
      return res.status(403).json({ success: false });
    }
    const cookie = req.body?.cookie;
    const userAgent = req.body?.userAgent;
    if (cookie !== null && (typeof cookie !== 'string' || cookie.length > 8192 || /[\r\n]/.test(cookie))) {
      return res.status(400).json({ success: false });
    }
    if (userAgent != null && (typeof userAgent !== 'string' || userAgent.length > 512 || /[\r\n]/.test(userAgent))) {
      return res.status(400).json({ success: false });
    }
    instagramService.setSessionCookie(cookie, userAgent || null);
    res.json({ connected: Boolean(cookie) });
  });

  app.get('/api/v1/internal/instagram-session', (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') || req.headers.origin) {
      return res.status(403).json({ success: false });
    }
    res.json({ connected: instagramService.hasSession() });
  });

  // Mount API Router tại /api/v1
  app.use('/api/v1', apiRouter);

  // Route báo tín hiệu focus cho Electron
  app.get('/api/v1/internal/focus', (req, res) => {
    res.json({ ok: true });
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  return app;
}

export function startServer(port?: number): Promise<import('http').Server> {
  const settings = loadSettings();
  const listenPort = port || Number(process.env.PORT) || settings.port || 8696;
  const app = createServer();
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, '127.0.0.1');
    server.once('listening', () => {
      console.log(`[Backend] Server running on http://127.0.0.1:${listenPort}/api/v1`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

// Nếu chạy trực tiếp từ CLI (tsx watch backend/src/server.ts)
if (require.main === module) {
  void startServer().catch(error => {
    console.error('[Backend] Failed to start:', error);
    process.exitCode = 1;
  });
}
