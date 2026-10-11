// 运行时探测 + 零依赖 IPC。
//
// 为什么不引 `@tauri-apps/api`：前端仍要能在纯浏览器里构建与跑测试（npm run dev /
// vitest），不该被拖进一个只有 Tauri 里才有意义的依赖。tauri.conf.json
// 开了 `withGlobalTauri`，壳会把 `__TAURI__` 注入到 window 上，直接用它就够。
//
// 同时探测 `__TAURI_INTERNALS__` 作为后备：某些注入时机下 `__TAURI__` 可能还没挂上，
// 但内部 IPC 通道一定在（`withGlobalTauri` 只是把它包装成公开对象）。

export function isTauri() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

function resolveInvoke() {
  if (typeof window === 'undefined') return null;
  const g = window.__TAURI__;
  if (g && g.core && typeof g.core.invoke === 'function') {
    return (cmd, args) => g.core.invoke(cmd, args);
  }
  const i = window.__TAURI_INTERNALS__;
  if (i && typeof i.invoke === 'function') {
    return (cmd, args) => i.invoke(cmd, args);
  }
  return null;
}

/** 调一次 Rust 命令。不在壳内时抛出，调用方按需兜底。 */
export async function invoke(cmd, args) {
  const fn = resolveInvoke();
  if (!fn) throw new Error(`IPC 不可用（当前不在 Tauri 壳内）：${cmd}`);
  return fn(cmd, args || {});
}

/** 监听壳事件（目前只有关窗握手用的 `shell://before-close`）。返回取消函数。 */
export async function listen(event, handler) {
  if (typeof window === 'undefined') return () => {};
  const g = window.__TAURI__;
  if (!g || !g.event || typeof g.event.listen !== 'function') return () => {};
  return g.event.listen(event, handler);
}
