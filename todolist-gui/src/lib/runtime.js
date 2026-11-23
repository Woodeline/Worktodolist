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

/**
 * 从 UA 判断宿主平台。只服务外壳布局（macOS overlay / Windows 自绘标题栏），
 * 不参与任何数据/业务判断 —— 所以浏览器里也能安全地返回 macos/windows。
 */
export function platformFromUA(ua) {
  const s = String(ua || '');
  if (/Macintosh|Mac OS X/.test(s)) return 'macos';
  if (/Windows/.test(s)) return 'windows';
  if (/Linux|X11/.test(s)) return 'linux';
  return 'web';
}

export function hostPlatform() {
  if (typeof navigator === 'undefined') return 'web';
  return platformFromUA(navigator.userAgent);
}

/** 外壳是否把上下文条抬进窗口第一行（自绘/合并标题栏）。浏览器与 Linux 不参与。 */
export function usesCustomTitlebar(platform) {
  return platform === 'macos' || platform === 'windows';
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

/**
 * 解析「监听壳事件」的能力（R-10）。
 *
 * 三级后备，只做前两级：
 *   ① `window.__TAURI__.event.listen`         —— `withGlobalTauri` 包装出来的公开面，第一优先
 *   ② `window.__TAURI_INTERNALS__.event.listen` —— 注入时机偏晚时 `__TAURI__` 可能还没挂上，
 *      但内部通道一定在
 *   ③ `__TAURI_INTERNALS__.invoke('plugin:event|listen', …)` —— **刻意不实现**：
 *      它的参数形状（event / target / handler 怎么序列化）是 Tauri 2 的实现细节，
 *      手里没有真实环境可验证时硬写一个猜出来的形状，比明确抛错更危险。
 *
 * 拿不到能力时 **抛错**，不返回 noop：静默 noop 会让「关窗握手」在用户完全不知情的
 * 情况下退化成「什么都不做」，关窗前最后 200ms 的改动直接丢 —— 而且没有任何迹象。
 *
 * ⚠ 大版本升级（Tauri 2 → 3）时必须回来复核这两级后备是否还成立。
 *
 * @returns {(event: string, handler: (payload: unknown) => void) => Promise<() => void>}
 * @throws {Error} 当前不在壳内，或壳没有暴露事件通道
 */
export function resolveListen() {
  if (typeof window === 'undefined') {
    throw new Error('IPC 不可用（没有 window）：listen');
  }
  const g = window.__TAURI__;
  if (g && g.event && typeof g.event.listen === 'function') {
    return (event, handler) => g.event.listen(event, handler);
  }
  const i = window.__TAURI_INTERNALS__;
  if (i && i.event && typeof i.event.listen === 'function') {
    return (event, handler) => i.event.listen(event, handler);
  }
  throw new Error('IPC 不可用（当前不在 Tauri 壳内或事件通道缺失）：listen');
}

/**
 * 监听壳事件（目前只有关窗握手用的 `shell://before-close`）。
 *
 * 返回取消函数；拿不到监听能力时**抛错**（见 {@link resolveListen}），
 * 调用方必须 try/catch 并自己准备后备刷盘 —— 不许返回 `null`，
 * 那会让调用方的 `.off()` 直接炸。
 *
 * @param {string} event
 * @param {(payload: unknown) => void} handler
 * @returns {Promise<() => void>}
 */
export async function listen(event, handler) {
  const attach = resolveListen();
  return attach(event, handler);
}

/**
 * 把主窗口隐藏到托盘（Esc 的最后一层，2026-11-17）。
 *
 * 先尽量把防抖窗口里的改动刷盘，再隐藏：藏起来之后用户可能很久都不回来，
 * 不能指望 200ms 的保存定时器还按时跑。刷盘失败也照样隐藏，否则快捷键像失灵。
 * 不在壳内（npm run dev / 单元测试）时什么都不做，返回 false。
 */
export async function hideToTray(saveNow) {
  if (!isTauri()) return false;
  try {
    if (typeof saveNow === 'function') await saveNow();
  } catch {
    // 尽力而为：保存失败不该把「藏窗」这个动作也拦住
  }
  try {
    await invoke('app_hide_to_tray');
    return true;
  } catch {
    return false;
  }
}
