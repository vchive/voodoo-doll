import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 002 原型独立构建：root 指向 hex/，产物落在项目根的 dist-hex/。
// 与 001 的 vite.config.js（root 为项目根）互不影响。
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export default defineConfig({
  root: here,
  // 默认舞台仅打包显式引用的已署名素材；不复制 public 中的历史付费素材。
  publicDir: false,
  base: './',
  build: {
    outDir: '../dist-hex',
    emptyOutDir: true,
  },
  server: {
    // 开发时把 /api 转给本地服务端（默认 8080）
    proxy: {
      '/api/v4': {
        target: process.env.WORLD_API_TARGET || 'http://localhost:8000',
        changeOrigin: false,
      },
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        // 保留浏览器 Host，使开发代理下的同源校验与正式服务一致。
        changeOrigin: false,
      },
    },
    fs: {
      // hex/doll.js 会 import ../shared/script-contract.js，需要放行仓库根
      allow: [repoRoot],
    },
  },
});
