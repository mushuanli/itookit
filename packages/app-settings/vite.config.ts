import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'AppSettings',
    fileName: 'app-settings',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/vfs-core',
      '@itookit/llm-driver',
      '@itookit/llm-engine',
      '@itookit/llm-ui'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs-core': 'VFSCore',
      '@itookit/llm-driver': 'LLMDriver',
      '@itookit/llm-engine': 'LLMEngine',
      '@itookit/llm-ui': 'LLMUI'
    }
  })
);
