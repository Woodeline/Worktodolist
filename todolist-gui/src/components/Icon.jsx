// 统一图标系统：内联 SVG，零依赖。
//
// 图标几何取自 **Lucide**（lucide-icons v1.57.0，ISC 许可），路径数据内联在本文件里，
// 因此仍然满足「运行时依赖 ≤ 5 个、完全离线、不引组件库」的硬约定 ——
// 换的是"用哪套图形"，不是"多一个依赖"。
//
// 名字 API 保持项目原有命名（plus / check-circle / …），到 Lucide 的对应关系写在每个条目后的注释里。
//
// 渲染规范（全组共用）：画布 24×24 · 描边 1.75 · 圆头圆角 · currentColor · 不填充。
//   —— Lucide 原设定是 2px；这里保留项目原有的 1.75，以免整体视觉重量变化。
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
  'file-check': (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m9 15 2 2 4-4" />
    </>
  ), // lucide:file-check
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
  'ruler': (
    <>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" />
      <path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" />
      <path d="m17.5 15.5 2-2" />
    </>
  ), // lucide:ruler
  'braces': (
    <>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </>
  ), // lucide:braces
  'regex': (
    <>
      <path d="M17 3v10" />
      <path d="m12.67 5.5 8.66 5" />
      <path d="m12.67 10.5 8.66-5" />
      <path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z" />
    </>
  ), // lucide:regex
  'calendar': (
    <>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </>
  ), // lucide:calendar
  'hash': (
    <>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </>
  ), // lucide:hash
  'shield': (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ), // lucide:shield-check
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
  'filter': (
    <>
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </>
  ), // lucide:funnel
  'eye': (
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ), // lucide:eye
  'globe': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  ), // lucide:globe
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
      strokeWidth="1.75"
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
