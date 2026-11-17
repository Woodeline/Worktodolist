// 统一图标系统：内联 SVG，零依赖。
//
// 图标几何取自 **Lucide**（lucide-icons v1.57.0，ISC 许可），路径数据内联在本文件里，
// 因此仍然满足「运行时依赖 ≤ 5 个、完全离线、不引组件库」的硬约定 ——
// 换的是"用哪套图形"，不是"多一个依赖"。
//
// 名字 API 保持项目原有命名（plus / check-circle / …），到 Lucide 的对应关系写在每个条目后的注释里。
//
// 渲染规范（全组共用）：画布 24×24 · 描边 1.5 · 圆头圆角 · currentColor · 不填充。
//   一套图标一个描边；尺寸收敛到 12 / 16 / 24 三档，由调用点显式给出。
//
// 例外：dot / circle-half 是语义状态图形（实心圆点、半实心圆），Lucide 没有等价的填充形状，
//       沿用项目自绘几何。
//
// 无障碍：默认 aria-hidden（纯装饰），传 title 时自动升级为 role="img" + aria-label。

const PATHS = {
  'plus': (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ), // lucide:plus
  'search': (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ), // lucide:search
  'pin': (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>
  ), // lucide:pin
  'x': (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ), // lucide:x
  'check': (
    <>
      <path d="M20 6 9 17l-5-5" />
    </>
  ), // lucide:check
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 9-5.5 5.5L8 12" />
    </>
  ), // lucide:circle-check
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ), // lucide:circle-alert
  'alert-triangle': (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ), // lucide:triangle-alert
  'star': (
    <>
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </>
  ), // lucide:star
  'circle-half': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </>
  ), // （Lucide 无等价半实心圆，自绘）
  'dot': (
    <>
      <circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none" />
    </>
  ), // （Lucide 无等价填充小圆，自绘）
  'chevron-right': (
    <>
      <path d="m9 18 6-6-6-6" />
    </>
  ), // lucide:chevron-right
  'chevron-left': (
    <>
      <path d="m15 18-6-6 6-6" />
    </>
  ), // lucide:chevron-left
  'chevron-down': (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ), // lucide:chevron-down
  'chevrons-down': (
    <>
      <path d="m7 6 5 5 5-5" />
      <path d="m7 13 5 5 5-5" />
    </>
  ), // lucide:chevrons-down
  'chevrons-up': (
    <>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 13 5-5 5 5" />
    </>
  ), // lucide:chevrons-up
  'menu': (
    <>
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </>
  ), // lucide:menu
  'settings': (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  ), // lucide:settings
  'toolbox': (
    <>
      <path d="M16 12v4" />
      <path d="M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      <path d="M17 6a2 2 0 011.414.586l3 3A2 2 0 0122 11v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 01.586-1.414l3-3A2 2 0 017 6z" />
      <path d="M2 14h20" />
      <path d="M8 12v4" />
    </>
  ), // lucide:toolbox
  'thermometer': (
    <>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </>
  ), // lucide:thermometer
  'calendar': (
    <>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </>
  ), // lucide:calendar
  'calendar-clock': (
    <>
      <path d="M16 14v2.2l1.6 1" />
      <path d="M16 2v3" />
      <path d="M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338" />
      <path d="M3 9h5.859" />
      <path d="M8 2v3" />
      <circle cx="16" cy="16" r="6" />
    </>
  ), // lucide:calendar-clock —— 侧栏「即将到期」
  'grid': (
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </>
  ), // lucide:layout-grid —— 侧栏「全部」
  'history': (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ), // lucide:history —— 侧栏「日志」
  'chart': (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ), // lucide:chart-column
  'flag': (
    <>
      <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />
    </>
  ), // lucide:flag
  'columns': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </>
  ), // lucide:columns-2
  'panel-left': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ), // lucide:panel-left —— 页眉最左的侧栏开关（2026-11-15 起，替代自绘折叠箭头）
  'filter': (
    <>
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </>
  ), // lucide:funnel
  'tag': (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
    </>
  ), // lucide:tag —— 窄屏底部导航的「标签」（分类 / 列表筛选用）
  'upload': (
    <>
      <path d="M12 3v12" />
      <path d="m17 8-5-5-5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </>
  ), // lucide:upload
  'clock': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ), // lucide:clock
  'list': (
    <>
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </>
  ), // lucide:list —— 活动栏「列表」
  'list-tree': (
    <>
      <path d="M21 12h-8" />
      <path d="M21 6H8" />
      <path d="M21 18h-8" />
      <path d="M3 6v4c0 1.1.9 2 2 2h3" />
      <path d="M3 10v6c0 1.1.9 2 2 2h3" />
    </>
  ), // lucide:list-tree —— 子任务进度（「2/5」前面那一枚小记号）
  'trash': (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </>
  ), // lucide:trash-2 —— 行内快捷删除
  'pencil': (
    <>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </>
  ), // lucide:pencil —— 备注角标（替代裸 Unicode ✎）
  'rotate-cw': (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ), // lucide:rotate-cw —— 重复标记（替代裸 Unicode ↻）
  'sun': (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ), // lucide:sun —— 主题档位「浅色」
  'moon': (
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  ), // lucide:moon —— 主题档位「深色」
  'monitor': (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ), // lucide:monitor —— 主题档位「跟随系统」
  'arrow-up-down': (
    <>
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
    </>
  ), // lucide:arrow-up-down —— 排序「自动」（按优先级 · 日期）
  'grip-vertical': (
    <>
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="19" r="1" />
    </>
  ), // lucide:grip-vertical —— 排序「手动」（文件行序，可拖拽）
};

export default function Icon({ name, size = 16, title, className = '', ...rest }) {
  const shape = PATHS[name];
  if (!shape) return null; // 未知图标名不渲染，避免出现空白方块

  const labelled = Boolean(title);
  // 用字符串拼接而不是模板字面量：scripts/qa-css-check.mjs 靠正则提取
  // className 令牌，嵌套反引号会解析出垃圾 token。
  return (
    <svg
      className={'icon' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled && <title>{title}</title>}
      {shape}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
