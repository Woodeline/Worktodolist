// Tauri 壳内才需要的三件壳级行为。全部包在 isTauri() 判断里 ——
// 不在壳内时（npm run dev / 单元测试）这些整体跳过，浏览器侧行为不受影响。
//
//   ① 关窗握手：Rust 拦下第一次关闭请求，等我们把防抖窗口里的改动刷盘后再放行。
//      浏览器版靠 visibilitychange / pagehide；WebView 里这两个事件的触发时机不保证，
//      所以必须显式握手，否则"关窗前最后 200ms 的改动"会丢。
//   ② 启动时一次 git 自动提交：时机与范围沿用旧 Python 脚本的约定（脚本本身已被本
//      移植取代并从仓库移除，见 src-tauri/src/git.rs），
//      时间戳由前端给（本地时间），避免在 Rust 里为日期引入依赖。
//   ③ 每日 09:00 的到期/逾期提醒：应用开着的时候由壳自己弹；应用没开的时候由计划
//      任务用 `Worktodolist.exe --reminder` 拉起隐藏实例完成（见 reminder.rs）。

import { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import { invoke, isTauri, listen } from '../lib/runtime.js';

/** 到下一个整点 hour 点的毫秒数。 */
function msUntilNextHour(hour) {
  const now = dayjs();
  let target = now.hour(hour).minute(0).second(0).millisecond(0);
  if (!target.isAfter(now)) target = target.add(1, 'day');
  return target.diff(now);
}

export function useNativeShell(store) {
  const dirReady = Boolean(store && store.dirReady);
  const lastSavedAt = store ? store.lastSavedAt : null;

  const saveNowRef = useRef(null);
  saveNowRef.current = store ? store.saveNow : null;
  const gitOnSaveRef = useRef(false);
  const reminderFiredRef = useRef('');

  // ① 关窗握手
  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten = null;
    let disposed = false;

    (async () => {
      const off = await listen('shell://before-close', async () => {
        try {
          if (saveNowRef.current) await saveNowRef.current();
        } catch {
          // 尽力而为：刷盘失败也必须放行，否则应用永远关不掉
        }
        try {
          await invoke('app_confirm_close');
        } catch {
          // 忽略
        }
      });
      if (disposed) off();
      else unlisten = off;
    })();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // ② 启动时一次自动提交（时机与 Python 版一致：应用起来的时候）
  useEffect(() => {
    if (!isTauri() || !dirReady) return;
    invoke('git_autocommit', { stamp: dayjs().format('YYYY-MM-DD HH:mm') }).catch(() => {});
  }, [dirReady]);

  // ②b 「保存后自动提交」开关。默认关闭 → 行为与迁移前完全一致。
  // 想打开：调用 invoke('ws_set_git_on_save', { enabled: true })（见迁移说明）。
  useEffect(() => {
    if (!isTauri() || !dirReady) return;
    invoke('ws_get_git_on_save')
      .then((v) => {
        gitOnSaveRef.current = Boolean(v);
      })
      .catch(() => {});
  }, [dirReady]);

  useEffect(() => {
    if (!isTauri() || !dirReady || !lastSavedAt || !gitOnSaveRef.current) return undefined;
    const timer = setTimeout(() => {
      invoke('git_autocommit', { stamp: dayjs().format('YYYY-MM-DD HH:mm') }).catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [lastSavedAt, dirReady]);

  // ③ 09:00 提醒（应用在运行时的那一半；没运行时交给 --reminder 计划任务）
  useEffect(() => {
    if (!isTauri() || !dirReady) return undefined;
    let cancelled = false;
    let timer = null;

    const fire = async () => {
      const today = dayjs().format('YYYY-MM-DD');
      if (!cancelled && reminderFiredRef.current !== today) {
        reminderFiredRef.current = today;
        try {
          const report = await invoke('reminder_check', { today });
          if (!cancelled && report && report.total > 0) {
            const lines = report.items.map((r) =>
              r.overdue_days > 0 ? `[逾期 ${r.overdue_days} 天] ${r.title}` : `[今天到期] ${r.title}`
            );
            if (report.total > report.items.length) {
              lines.push(`…… 以及另外 ${report.total - report.items.length} 条`);
            }
            await invoke('notify', { title: '待办清单提醒', body: lines.join('\n') });
          }
        } catch {
          // 提醒是增强，失败静默
        }
      }
      if (!cancelled) timer = setTimeout(fire, msUntilNextHour(9));
    };

    // 先对齐到下一个 09:00，而不是立刻弹一次 —— 立刻弹会让"每次开应用都被通知一次"
    timer = setTimeout(fire, msUntilNextHour(9));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [dirReady]);
}
