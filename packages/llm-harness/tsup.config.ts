import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    '@itookit/common',
    '@itookit/device-llm',
    '@itookit/device-tty',
    '@itookit/tools',
    /^node:/,
  ],
});
