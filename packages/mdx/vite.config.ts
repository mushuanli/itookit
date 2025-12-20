import { defineConfig } from 'vite';
import { createLibConfig } from '../../scripts/vite-lib.config';

export default defineConfig(
  createLibConfig({
    name: 'MDxEditor',
    fileName: 'mdxeditor',
    rootDir: __dirname,
    external: [
      '@itookit/common',
      '@itookit/vfs-core',
      /^@codemirror\//,      // 正则匹配所有 codemirror 包
      'codemirror',
      'marked',
      'mermaid',
      'front-matter',
      'gray-matter'
    ],
    globals: {
      '@itookit/common': 'ItookitCommon',
      '@itookit/vfs-core': 'VFSCore',
      'codemirror': 'CodeMirror',
      'marked': 'marked',
      'mermaid': 'mermaid',
      'front-matter': 'fm', // 修复 front-matter 警告
      'gray-matter': 'gm',
      // 手动补充 CodeMirror 的子模块映射以消除警告
      '@codemirror/state': 'CM.state',
      '@codemirror/view': 'CM.view',
      '@codemirror/commands': 'CM.commands',
      '@codemirror/language': 'CM.language',
      '@codemirror/autocomplete': 'CM.autocomplete',
      '@codemirror/lint': 'CM.lint',
      '@codemirror/search': 'CM.search',
      '@codemirror/lang-markdown': 'CM.langMarkdown'
    }
  })
);
