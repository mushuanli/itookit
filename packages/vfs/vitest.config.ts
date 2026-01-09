import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 设置测试环境为 jsdom，以模拟浏览器环境
    // 这对于 fake-indexeddb 至关重要
    environment: 'jsdom',

    // 指定在所有测试文件运行前需要加载的设置文件
    // 你的 vitest.setup.js 路径可能需要调整
    // 假设它在包的根目录下
    setupFiles: ['./vitest.setup.js'], 
  },
});