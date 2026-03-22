// packages/vfslib/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'backend/index': 'src/backend/index.ts',
        'testing/index': 'src/testing/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['@itookit/common'],
    splitting: true,
    treeshake: true,
});
