import { defineConfig } from 'tsup';

export default defineConfig({
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['@itookit/vfs-core'],
    splitting: false,
    treeshake: true,
    platform: 'browser',
    target: 'es2022',
});
