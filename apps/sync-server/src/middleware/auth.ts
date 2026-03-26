import type { Context, Next } from 'hono';
import { config } from '../config.js';

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== config.token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}
