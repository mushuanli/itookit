import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'LLMUI',
    fileName: 'llm-ui',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/vfs-core',
      '@itookit/llm-driver',
      '@itookit/llm-engine',
      '@itookit/mdxeditor',
      'marked',
      'js-yaml'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs-core': 'VFSCore',
      '@itookit/llm-driver': 'LLMDriver',
      '@itookit/llm-engine': 'LLMEngine',
      '@itookit/mdxeditor': 'MDxEditor',
      'marked': 'marked',
      'js-yaml': 'jsyaml'
    }
  })
);
