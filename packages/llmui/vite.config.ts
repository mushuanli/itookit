import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    // 开启 lib 模式，专门用于构建库
    lib: {
      // **关键**: 指向 TypeScript 入口文件
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LLMUI', // UMD 构建的全局变量名
      formats: ['es', 'umd'],
      fileName: (format) => `llm-ui.${format === 'es' ? 'js' : 'umd.cjs'}`
    },
    // 【新增】: 强制禁用 CSS 代码拆分，确保所有 CSS 合并为一个文件
    cssCodeSplit: false,
    
    rollupOptions: {
      // 将无需打包进库的依赖外部化
      external: [
        '@itookit/common',
        '@itookit/vfs-core', // 如果 LLMUI 需要直接操作 VFS 类型
        'marked'             // 如果用于 markdown 渲染，建议外部化或打包进去视体积而定
      ],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          '@itookit/common': 'ItookitCommon',
          '@itookit/vfs-core': 'VFSCore',
          'marked': 'marked'
        },
        // 确保CSS被提取为单独的文件
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'style.css';
          }
          return assetInfo.name;
        }
      }
    },
    // 为库构建开启 sourcemap
    sourcemap: true,
    // 清空输出目录
    emptyOutDir: true,
  },
  plugins: [
    // 使用 vite-plugin-dts 自动生成类型声明文件
    dts({
      // 指定 rollup 类型声明的入口文件
      entryRoot: 'src',
      // 输出目录
      outDir: 'dist',
      // 在构建后将所有类型合并到一个文件中
      insertTypesEntry: true,
    })
  ]
});
