import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'LLMUI',
    fileName: 'llm-ui',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/stdio',
      '@itookit/device-llm',
      '@itookit/llm-session',
      '@itookit/mdxeditor',
      'marked',
      'js-yaml'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/stdio': 'ItookitStdio',
      '@itookit/device-llm': 'LLMDriver',
      '@itookit/llm-session': 'LLMConversation',
      '@itookit/mdxeditor': 'MDxEditor',
      'marked': 'marked',
      'js-yaml': 'jsyaml'
    }
  })
);
