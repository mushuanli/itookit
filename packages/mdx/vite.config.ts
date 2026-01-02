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
      // 建议保留正则作为兜底，但必须显式添加报错的包
      /^@codemirror\//,      
      'codemirror',
      'marked',
      'mermaid',
      'front-matter',
      'gray-matter',
      // --- 👇 显式添加这些 CodeMirror 子包 ---
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/lang-markdown'
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
