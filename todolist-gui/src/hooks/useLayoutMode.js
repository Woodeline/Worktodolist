// 主区可用宽度 → 有效布局。
//
// 刻意不读 window.innerWidth：日历的可用宽度还受侧栏折叠、设置页覆盖、
// 对话快照列影响，视口宽不等于主区宽。这里直接观测 <main> 的内容盒，
// 与 CSS 的窄屏降级看的是同一块地方。
//
// 所有 Hook 都在函数顶部无条件调用 —— v1.1.0 那条「Hook 数量必须恒定」的规矩。
import { useEffect, useState } from 'react';
import { hysteresisNarrow, resolveEffectiveMode } from '../lib/layoutMode.js';

/** 元素卸载 / 环境不支持 ResizeObserver 时返回 null，由迟滞逻辑保持上一次判定。 */
export function useElementWidth(el) {
  const [width, setWidth] = useState(null);

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') {
      setWidth(null);
      return undefined;
    }
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0] && entries[0].contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return width;
}

/**
 * @returns {{effective: string, narrow: boolean, override: string|null,
 *            width: number|null, setOverride: Function}}
 */
export function useLayoutMode({ preferred, mainEl }) {
  const width = useElementWidth(mainEl);
  const [narrow, setNarrow] = useState(false);
  // 用户显式覆盖：只在本次窄边区间有效，不落盘、不广播。
  const [override, setOverride] = useState(null);

  useEffect(() => {
    setNarrow((prev) => hysteresisNarrow(prev, width));
  }, [width]);

  // 回到宽边就清掉覆盖。偏好从未被改写，所以「还原原视图」是自然结果，
  // 不需要另存一份 storedMode —— 那正是评估里判定不可行的单值模型。
  useEffect(() => {
    if (!narrow) setOverride(null);
  }, [narrow]);

  const effective = resolveEffectiveMode({ preferred, narrow, override });
  return { effective, narrow, override, width, setOverride };
}
