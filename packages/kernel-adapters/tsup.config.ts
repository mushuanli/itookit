import { defineConfig } from 'tsup';

export default defineConfig({
    entry: { 'llm-core': 'src/llm-management/core.ts', 'llm-presets': 'src/llm-management/presets.ts', contracts: 'src/contracts.ts', index: 'src/index.ts', llm: 'src/llm-management/index.ts', 'mcp-stdio': 'src/llm-management/skills/mcp-stdio.ts', 'mcp-stdio-browser': 'src/llm-management/skills/mcp-stdio-browser.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: [
        '@itookit/common',
        '@itookit/driver-llm',
        '@itookit/durable-kernel',
        '@itookit/vfs-core',
        '@itookit/tools',
    ],
});
