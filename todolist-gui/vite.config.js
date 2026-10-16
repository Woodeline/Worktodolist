import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// 只在 vitest 进程里把临时目录指到项目内。
// 原因：本机对 %TEMP% 的写入偶发 EPERM，vitest 会因此在写 SSR 缓存时
// 抛未处理异常，并把那个 worker 里的整个测试文件丢掉——但其余文件照跑、
// 汇总仍显示通过。也就是说一次"绿"可能是假的。放到项目内即可绕开。
if (process.env.VITEST) {
  const tmpDir = path.join(rootDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;
  process.env.TMPDIR = tmpDir;
}

// 开发/预览端口固定为 15181，不用 vite 默认的 5173。
// 原因（本机实测 2026-10-15）：5173 落在 Windows 的 TCP 保留端口段 5173-5272 内
//   （netsh interface ipv4 show excludedportrange protocol=tcp 可查，通常是 Hyper-V /
//   WSL / Docker 的 winnat 抢的）。被排除的端口任何进程都绑不上，vite 会以
//   EACCES 起不来，tauri dev 随之失败。15181 不在任何保留段、也不在动态端口范围
//   （本机 1024-15000）内，实测可稳定绑定。
// strictPort:true 让端口被占时直接报错，而不是静默漂移 —— 漂移会让 tauri.conf.json
//   里的 devUrl 对不上，表现为白屏而不是启动失败，更难排查。
const DEV_PORT = 15181;

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    port: DEV_PORT,
    strictPort: true,
  },
  test: {
    environment: 'node',
    globals: true,
    // 逐个文件串行跑，避免 worker 崩溃时连坐丢文件；本套用例总量小，代价可忽略
    fileParallelism: false,
  },
});
