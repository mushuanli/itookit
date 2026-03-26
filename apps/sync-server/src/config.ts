import 'dotenv/config';
import { mkdirSync } from 'node:fs';

export const config = {
  port: parseInt(process.env.PORT ?? '4321', 10),
  dataDir: process.env.DATA_DIR ?? './data',
  token: process.env.TOKEN ?? '',
} as const;

if (!config.token) {
  console.warn('[config] WARNING: TOKEN is not set. All requests will be rejected.');
}

mkdirSync(config.dataDir, { recursive: true });
