import { defineConfig } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    // 开启库模式
    lib: {
      // 指定库的入口文件
      entry: path.resolve(__dirname, 'src/index.ts'),
      
      // 为 UMD 构建模式指定一个全局变量名
      name: 'VfsCore',
      
      // 定义输出文件的名称格式
      // (format) => `vfs.${format}.js` 会生成 vfs.es.js 和 vfs.umd.js
      fileName: (format) => `vfs.${format}.js`,
      
      // 指定要生成的模块格式
      formats: ['es', 'umd'],
    },
    // 配置 Rollup 选项，用于更精细的控制
    rollupOptions: {
      // 将你的库依赖的外部模块排除在打包之外
      // 这样可以减小打包文件的大小，并避免版本冲突
      // 消费者（使用你库的项目）需要自己安装这些依赖
      external: ['@itookit/common', 'uuid'],
      
      output: {
        // 为 UMD 格式的外部依赖指定全局变量
        globals: {
          uuid: 'uuid',
        },
      },
    },
    // sourcemap: true, // 可选：如果你想生成 source map 用于调试
  },
  // 添加 dts 插件，它会自动生成 TypeScript 类型声明文件 (.d.ts)
  plugins: [
    dts({
      // 指定 dts 插件的入口文件
      entryRoot: 'src',
    }),
  ],
});