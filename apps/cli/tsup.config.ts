import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/cli.ts'],
    format: ['esm'],
    clean: true,
    sourcemap: true,
    // Bundled CJS dependencies (including MCP stdio's cross-spawn) need Node require in ESM chunks.
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cliCreateRequire } from "node:module";\nconst require = __cliCreateRequire(import.meta.url);' },
    // Keep native file dependencies resolved from their owning published package.
    noExternal: [/^@itookit\/(?!vfsdriver-local(?:\/|$))/],
    external: ['@itookit/vfsdriver-local', 'better-sqlite3', 'node-pty'],
});
