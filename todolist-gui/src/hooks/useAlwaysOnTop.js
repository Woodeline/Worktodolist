// 「窗口置顶」开关。
//
// 置顶状态有三个来源：窗口本身（Rust）、前端按钮、托盘菜单的勾选项。
// **Rust 侧是唯一权威**，前端只持有它的投影：点按钮 → 调用命令 → 命令改窗口后
// 广播 `shell://always-on-top`；从托盘菜单改 → 走同一条广播。这样按钮和托盘
// 不会各说各话。偏好同时落一份在本机 localStorage（与其它本机配置同一套存储约定），
// 下次启动时由本 hook 重新应用到窗口。
import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri, listen } from '../lib/runtime.js';
import { createConfigStore } from '../lib/configStore.js';

// 壳级偏好：一个 store 一个键，与其它本机配置互不影响。
const shellPrefs = createConfigStore({
  key: 'worktodolist.shell',
  defaults: { alwaysOnTop: false },
  normalize: (c) => ({ alwaysOnTop: Boolean(c && c.alwaysOnTop) }),
});

/** 上次保存的置顶偏好（浏览器里也能读，纯前端测试不受影响）。 */
export function loadAlwaysOnTop() {
  return shellPrefs.loadOr().alwaysOnTop;
}

/**
 * @returns {{onTop:boolean, toggle:() => void}}
 *   onTop  窗口当前是否置顶（跟随壳广播更新）
 *   toggle 切换置顶：先写偏好与本地状态，再通知壳
 */
export function useAlwaysOnTop() {
  const [onTop, setOnTop] = useState(loadAlwaysOnTop);

  useEffect(() => {
    if (!isTauri()) return undefined;
    // 启动时把上次的选择应用到窗口（窗口默认不置顶，所以只在需要时才发命令）
    if (loadAlwaysOnTop()) {
      invoke('app_set_always_on_top', { enabled: true }).catch(() => {});
    }

    let off = null;
    let disposed = false;
    (async () => {
      const un = await listen('shell://always-on-top', (e) => {
        const v = Boolean(e && e.payload);
        shellPrefs.save({ alwaysOnTop: v });
        setOnTop(v);
      });
      if (disposed) un();
      else off = un;
    })();

    return () => {
      disposed = true;
      if (off) off();
    };
  }, []);

  const toggle = useCallback(() => {
    const v = !onTop;
    setOnTop(v);
    shellPrefs.save({ alwaysOnTop: v });
    if (isTauri()) invoke('app_set_always_on_top', { enabled: v }).catch(() => {});
  }, [onTop]);

  return { onTop, toggle };
}
