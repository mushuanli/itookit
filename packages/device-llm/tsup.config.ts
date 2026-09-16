import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'mcp-stdio': 'src/skills/mcp-stdio.ts', 'mcp-stdio-browser': 'src/skills/mcp-stdio-browser.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@itookit/common', '@itookit/vfs-core', 'js-yaml'],
});
