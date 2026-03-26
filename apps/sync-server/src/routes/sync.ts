import { Hono } from 'hono';
import { getAllFiles, getFile, readBlob, upsertFile, writeBlob } from '../db.js';

interface FileMeta {
  path: string;
  hash: string;
  mtime: number;
  is_deleted: boolean;
}

const sync = new Hono();

// GET /api/sync/ping — connectivity check
sync.get('/ping', (c) => c.json({ ok: true, ts: Date.now() }));

// POST /api/sync/check — diff computation
sync.post('/check', async (c) => {
  const clientFiles: FileMeta[] = await c.req.json();

  const clientMap = new Map(clientFiles.map((f) => [f.path, f]));
  const serverDocs = getAllFiles();
  const serverMap = new Map(serverDocs.map((d) => [d.path, d]));

  const files_to_upload: string[] = [];
  for (const cf of clientFiles) {
    const srv = serverMap.get(cf.path);
    if (!srv || (cf.hash !== srv.hash && cf.mtime >= srv.mtime)) {
      files_to_upload.push(cf.path);
    }
  }

  const files_to_download: FileMeta[] = [];
  for (const srv of serverDocs) {
    if (srv.is_deleted) continue;
    const cli = clientMap.get(srv.path);
    if (!cli || (srv.hash !== cli.hash && srv.mtime > cli.mtime)) {
      files_to_download.push({ path: srv.path, hash: srv.hash, mtime: srv.mtime, is_deleted: false });
    }
  }

  return c.json({ files_to_upload, files_to_download });
});

// POST /api/sync/upload — upload files via FormData
sync.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const now = Date.now();

  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File)) continue;

    const path = key;
    const arrayBuf = await value.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuf);
    const hash = Buffer.from(hashBuf).toString('hex');

    // optional: client may send mtime as a separate form field
    const mtimeRaw = formData.get(`${path}:mtime`);
    const mtime = mtimeRaw ? parseInt(String(mtimeRaw), 10) : now;

    writeBlob(hash, buf);
    upsertFile(path, hash, mtime);
  }

  return c.json({ ok: true });
});

// POST /api/sync/download — download a single file by path
sync.post('/download', async (c) => {
  const { path } = await c.req.json<{ path: string }>();
  const meta = getFile(path);

  if (!meta || meta.is_deleted) {
    return c.json({ error: 'Not found' }, 404);
  }

  const buf = readBlob(meta.hash);

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Hash': meta.hash,
      'X-File-Mtime': String(meta.mtime),
    },
  });
});

export { sync };
