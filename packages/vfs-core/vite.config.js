// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    // 构建为库
    lib: {
      // 库的入口文件
      entry: resolve(__dirname, 'src/index.js'),
      // 库的全局变量名 (UMD 格式需要)
      name: 'VFSCore',
      // 输出的文件名
      fileName: (format) => `vfs-core.${format}.js`,
    },
    rollupOptions: {
      // 确保外部化处理那些你不想打包进库的依赖
      external: ['uuid', '@itookit/common'],
      output: {
        // 在 UMD 构建模式下为这些外部化的依赖提供一个全局变量
        globals: {
          uuid: 'uuid',
          '@itookit/common': 'itookitCommon',
        },
      },
    },
  },
  plugins: [
    // 这个插件会自动从你的源码生成 .d.ts 文件
    dts({
        // 指定d.ts文件输出目录，默认为 'dist'
        outDir: 'dist',
        // 如果你的类型定义是手动维护的，可以这样复制
        // 如果是 .ts 文件，它会自动生成
        // 由于你是手动维护的 .d.ts，这里我们直接复制
        staticImport: true,
        insertTypesEntry: true,
        copyDtsFiles: true,
    }),
  ],
});
