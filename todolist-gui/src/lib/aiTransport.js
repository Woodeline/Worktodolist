// AI 兜底的出机通道。浏览器走 fetch（Vite 代理），Tauri 走壳里的 `ai_chat` 命令。
//
// 为什么不是"再抽象一层传输接口"：`aiFallback.js` 里那 9 档诊断
// （proxy / auth / model / request / upstream / timeout / network / format / success）
// 全靠读 `res.status` / `res.text()` / `res.json()` / `res.clone()` 来分档。
// 所以这里刻意**只替换"怎么拿到响应"**，并让返回值与 fetch 的 Response 行为等价——
// 调用侧一行都不用改，既有测试也不用改。

import { invoke, isTauri } from './runtime.js';

/** 把 Rust 命令的结果包装成 fetch Response 的最小同构体。 */
function toResponse(payload) {
  const text = String((payload && payload.body) ?? '');
  const status = Number((payload && payload.status) || 0);
  return {
    ok: Boolean(payload && payload.ok),
    status,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text);
    },
    // testAiConnection 会用 clone().text() 读 403 的正文来区分
    // 「本地代理拒绝」与「上游自己的 403」，所以必须实现 clone。
    clone() {
      return toResponse({ ok: payload && payload.ok, status, body: text });
    },
  };
}

/**
 * 与 `fetch(url, init)` 同签名的 Tauri 版实现。
 * 从 init 里原样取出原来给代理用的三样东西，交给 Rust。
 */
export function tauriFetch(url, init = {}) {
  const headers = init.headers || {};
  const target = headers['x-ai-target'] || headers['X-Ai-Target'] || '';
  const auth = headers.Authorization || headers.authorization || '';
  const apiKey = String(auth).replace(/^Bearer\s+/i, '');
  const body = typeof init.body === 'string' ? init.body : '';
  // 浏览器侧的 url 形如 /ai-proxy/chat/completions；上游路径要去掉代理前缀
  const path = String(url || '').replace(/^\/ai-proxy/, '') || '/';

  const call = invoke('ai_chat', { target, apiKey, path, body }).then(toResponse);

  const signal = init.signal;
  if (!signal) return call;

  // 超时语义与浏览器版对齐：AbortSignal.timeout 触发时抛名称同为
  // TimeoutError 的错误，这样 aiFallback 的 timeout 分档与重试判据都照旧生效。
  const aborted = new Promise((_, reject) => {
    const fire = () => {
      const err = new Error('请求超时');
      err.name = 'TimeoutError';
      reject(err);
    };
    if (signal.aborted) fire();
    else signal.addEventListener('abort', fire, { once: true });
  });
  return Promise.race([call, aborted]);
}

/** 当前环境该用哪个 fetch。浏览器下就是全局 fetch（行为零变化）。 */
export function pickFetch() {
  return isTauri() ? tauriFetch : fetch;
}
