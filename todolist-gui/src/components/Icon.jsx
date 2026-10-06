// 统一图标系统：内联 SVG，零依赖。
//
// 为什么自己写而不用图标库：项目硬约定「运行时依赖 ≤ 5 个，不引组件库」，
// 且应用要求完全离线；引入 lucide-react 等会为了十来个图标多带一个包。
//
// 造型规范（全组共用，保证"风格统一"）：
//   画布 24×24 · 描边 1.75 · 圆头圆角 · currentColor · 不填充
//   —— 统一的网格与线宽是"看起来像一套"的真正原因，比换图标库更关键。
//
// 无障碍：默认 aria-hidden（纯装饰），传 title 时自动升级为 role="img" + aria-label。
const PATHS = {
  plus: (
    <>
      <path d="M12 5.25v13.5" />
      <path d="M5.25 12h13.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M15.2 15.2 20 20" />
    </>
  ),
  x: (
    <>
      <path d="M6.5 6.5 17.5 17.5" />
      <path d="M17.5 6.5 6.5 17.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.25 12.4 2.6 2.6L15.9 9.9" />
    </>
  ),
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.75v5" />
      <path d="M12 16v.01" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 4.2 3.4 19.2h17.2L12 4.2Z" />
      <path d="M12 9.75v4" />
      <path d="M12 16.6v.01" />
    </>
  ),
  star: (
    <path d="m12 4.3 2.42 4.9 5.41.79-3.92 3.82.93 5.39L12 16.66l-4.84 2.54.93-5.39L4.17 9.99l5.41-.79L12 4.3Z" />
  ),
  // 只画半圆：语义是"半完成 / 未落盘"，与 dot 的实心区分开
  'circle-half': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none" />,
  'chevron-right': <path d="m9.75 5.5 6.5 6.5-6.5 6.5" />,
  'chevron-down': <path d="m5.5 9.75 6.5 6.5 6.5-6.5" />,
  // 空态用：一份文本文档 + 勾，呼应"纯文本文件"
  'file-check': (
    <>
      <path d="M13.5 3.75H7a1.75 1.75 0 0 0-1.75 1.75v13a1.75 1.75 0 0 0 1.75 1.75h10a1.75 1.75 0 0 0 1.75-1.75V9l-5.25-5.25Z" />
      <path d="M13.5 3.75V9H18.75" />
      <path d="m9.5 14.4 1.75 1.75L15 12.4" />
    </>
  ),
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
