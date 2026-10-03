import { defineConfig } from 'tsup';

// Bundle neutral contracts while retaining the identity of public Kernel and UI classes.
const contractPaths = {
    '@itookit/driver-llm/contracts': ['../driver-llm/src/contracts.ts'],
    '@itookit/tools/contracts': ['../tools/src/contracts.ts'],
    '@itookit/tools/mcp-contracts': ['../tools/src/mcp-contracts.ts'],
    '@itookit/kernel-adapters/contracts': ['../kernel-adapters/src/contracts.ts'],
    '@itookit/llm-tasks/contracts': ['../llm-tasks/src/contracts.ts'],
};

export default defineConfig({
    entry: { index: 'src/index.ts', chat: 'src/chat.ts', startup: 'src/startup.ts', settings: 'src/settings.ts', legacy: 'src/legacy.ts' },
    format: ['esm'],
    dts: { only: true, resolve: Object.keys(contractPaths), compilerOptions: { rootDir: '..', paths: contractPaths } },
    noExternal: Object.keys(contractPaths),
    clean: false,
});
