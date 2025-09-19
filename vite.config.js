// vite.config.js
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  
  // 新增或修改此项
  root: 'src', // 指定项目根目录为 src

  // 注意：设置 root 后，Vite 会从 src 目录启动开发服务器
  // build.outDir 仍然会相对于项目根目录，而不是新的 root
  build: {
    outDir: '../dist' // 因为 root 是 'src'，所以输出目录要用 '../dist' 来指向项目根目录下的 dist
  }
});