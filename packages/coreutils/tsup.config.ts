import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: [
        '@itookit/common',
        '@itookit/device-llm',
        '@itookit/harness',
        '@itookit/stdio',
        '@itookit/tools',
    ],
});
