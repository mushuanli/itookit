import { defineConfig } from '../vfs-core/node_modules/vitest/dist/config.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            '@itookit/vfs-core': fileURLToPath(new URL('../vfs-core/src/index.ts', import.meta.url)),
        },
    },
    test: { environment: 'node' },
});
