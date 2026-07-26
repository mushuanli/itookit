import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'LLMUI',
    fileName: 'llm-ui',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/vfs',
      '@itookit/device-llm',
      '@itookit/llm-conversation',
      '@itookit/mdxeditor',
      'marked',
      'js-yaml'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs': 'VFSCore',
      '@itookit/device-llm': 'LLMDriver',
      '@itookit/llm-conversation': 'LLMConversation',
      '@itookit/mdxeditor': 'MDxEditor',
      'marked': 'marked',
      'js-yaml': 'jsyaml'
    }
  })
);
