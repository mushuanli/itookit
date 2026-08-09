import { defineConfig } from '../stdio/node_modules/vitest/dist/config.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            '@itookit/stdio': fileURLToPath(new URL('../stdio/src/index.ts', import.meta.url)),
        },
    },
    test: { environment: 'node' },
});
