import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { sync } from './routes/sync.js';

const app = new Hono();

// CORS must come before auth so preflight OPTIONS requests are not blocked
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

app.use('/api/sync/*', authMiddleware);
app.route('/api/sync', sync);

app.get('/health', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] Sync server running at http://localhost:${info.port}`);
  console.log(`[server] Data directory: ${config.dataDir}`);
});
