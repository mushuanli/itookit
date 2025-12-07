import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    // 开启 lib 模式
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LLMEngine', // UMD 全局变量名
      formats: ['es', 'umd'],
      fileName: (format) => `llm-engine.${format === 'es' ? 'js' : 'umd.cjs'}`
    },
    // Engine 不需要处理 CSS，移除 cssCodeSplit 相关配置
    
    rollupOptions: {
      // 外部化依赖，不打包进 Engine 库，避免代码冗余和版本冲突
      external: [
        '@itookit/common',
        '@itookit/vfs-core',
        '@itookit/llmdriver',
        'js-yaml'
      ],
      output: {
        // UMD 构建时使用的全局变量名
        globals: {
          '@itookit/common': 'ItookitCommon',
          '@itookit/vfs-core': 'VFSCore',
          '@itookit/llmdriver': 'LLMDriver',
          'js-yaml': 'jsyaml'
        }
      }
    },
    // 开启 sourcemap 方便调试核心逻辑
    sourcemap: true,
    emptyOutDir: true,
  },
  plugins: [
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      insertTypesEntry: true,
      // Engine 层可能不需要把所有类型合并，视具体情况而定
      // rollupTypes: true 
    })
  ]
});
