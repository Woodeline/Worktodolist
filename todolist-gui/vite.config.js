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

// 把代理目标打到这个必拒绝的端口上 = 拒绝转发（连接立即被操作系统拒绝）。
export const REJECT_TARGET = 'http://127.0.0.1:9';

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // 本机回环的其它形式（::ffff:127.x 等 IPv4-mapped 地址）
  if (h.startsWith('::ffff:127.')) return true;
  return false;
}

/**
 * 计算代理的真实转发目标。
 * @param {string|undefined} raw x-ai-target 请求头的原始值
 * @returns {string} 可转发的目标 URL，或 REJECT_TARGET 表示拒绝
 *
 * P2-2 硬化：目标完全由请求头决定时，这个代理就是一个无鉴权的开放转发器。
 * 两条防线：
 *   1) 只接受绝对 http(s) URL；
 *   2) 拒绝回环 / 内网网段目标（防 SSRF 跳板）。
 * 例外通道：本地大模型（Ollama 等）确实需要指向内网，设环境变量
 *   TODOLIST_AI_ALLOW_HOSTS=host1,host2  可显式放行（精确主机名匹配）。
 */
export function resolveProxyTarget(raw) {
  const value = String(raw || '').trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    return REJECT_TARGET;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return REJECT_TARGET;

  const host = url.hostname.toLowerCase();
  if (!isPrivateHost(host)) return value;

  const allow = (process.env.TODOLIST_AI_ALLOW_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.includes(host)) return value;
  return REJECT_TARGET;
}

// AI 兜底专用的 CORS 绕行通道。
// 第三方 API（OpenAI 等）不返回 CORS 头，浏览器直连必被拦；本地服务端转发就没有
// 这个问题。目标源通过 x-ai-target 请求头传入（经 resolveProxyTarget 校验）。
// dev 与 preview 共用同一份规则：日常双击跑的是 preview（服务 dist/），
// 没有这条，切到 preview 后 AI 兜底会静默失效。
//
// 实现注意（2026-10-06 实测）：vite/http-proxy **没有 router 选项**——vite 的
// proxy middleware 只认 bypass/rewrite/configure 等（router 会被静默忽略）。
// 原实现把 router 当动态目标用，实际上从未生效：所有 /ai-proxy 请求都被转发到
// 静态 target(localhost:80) 然后 ECONNREFUSED→500。正确做法是利用 http-proxy
// 的「每请求覆盖 target」能力（web() 会把传入的 options 合并覆盖全局配置），
// 在 configure 里包装 proxy.web，按请求头注入经校验的目标。
const aiProxyRules = {
  '/ai-proxy': {
    // 占位 target：正常请求都会被下面的包装注入真实目标后转发；
    // 万一包装路径没走到（未来 vite 改行为），这里也是必拒绝端口，不会变成开放转发。
    target: 'http://127.0.0.1:9',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/ai-proxy/, ''),
    configure: (proxy) => {
      const originalWeb = proxy.web.bind(proxy);
      proxy.web = (req, res, opts) => {
        const target = resolveProxyTarget(req.headers['x-ai-target']);
        if (target === REJECT_TARGET) {
          res.statusCode = 403;
          res.end('ai-proxy: target rejected (not in allowlist / not public http[s])');
          return;
        }
        originalWeb(req, res, { ...opts, target });
      };
      proxy.on('proxyReq', (proxyReq) => {
        // 这个头是给代理自己看的，转发出去会污染上游请求
        proxyReq.removeHeader('x-ai-target');
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: aiProxyRules,
  },
  preview: {
    proxy: aiProxyRules,
  },
  test: {
    environment: 'node',
    globals: true,
    // 逐个文件串行跑，避免 worker 崩溃时连坐丢文件；本套用例总量小，代价可忽略
    fileParallelism: false,
  },
});
