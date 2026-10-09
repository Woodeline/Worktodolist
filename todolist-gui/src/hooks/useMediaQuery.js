// 极简媒体查询订阅（只用于「左栏在窄屏转横向段控条」这一处的行为降级）。
//
// 为什么不纯靠 CSS：折叠状态是 React 里的数据。若只在 CSS 里把分组头藏掉，
// 被折叠那组里的工具会在窄屏上整个消失 —— 用户明明还能用，却找不到入口。
// 所以在窄屏上主动**不做折叠**（平铺），这是一个行为决定，不是样式决定。
import { useEffect, useState } from 'react';

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else if (typeof mq.removeListener === 'function') mq.removeListener(onChange);
    };
  }, [query]);

  return matches;
}
