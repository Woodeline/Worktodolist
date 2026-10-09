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
  'chevron-left': <path d="m14.25 5.5-6.5 6.5 6.5 6.5" />,
  'chevron-down': <path d="m5.5 9.75 6.5 6.5 6.5-6.5" />,
  // 应用菜单（原生菜单栏那个位置）
  menu: (
    <>
      <path d="M4.5 7h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 17h15" />
    </>
  ),
  // 设置：齿轮 = 圆心 + 八根齿，与全组网格（24 / 1.75）一致
  settings: (
    <>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.6v2.4" />
      <path d="M12 18v2.4" />
      <path d="M20.4 12H18" />
      <path d="M6 12H3.6" />
      <path d="m17.94 6.06-1.7 1.7" />
      <path d="m7.76 16.24-1.7 1.7" />
      <path d="m17.94 17.94-1.7-1.7" />
      <path d="m7.76 7.76-1.7-1.7" />
    </>
  ),
  // 空态用：一份文本文档 + 勾，呼应"纯文本文件"
  'file-check': (
    <>
      <path d="M13.5 3.75H7a1.75 1.75 0 0 0-1.75 1.75v13a1.75 1.75 0 0 0 1.75 1.75h10a1.75 1.75 0 0 0 1.75-1.75V9l-5.25-5.25Z" />
      <path d="M13.5 3.75V9H18.75" />
      <path d="m9.5 14.4 1.75 1.75L15 12.4" />
    </>
  ),
  // 工具集：2×2 方块 = "一排可以放东西的格子"，桌面程序里最常见的工具箱语汇
  toolbox: (
    <>
      <rect x="3.75" y="3.75" width="7" height="7" rx="1.5" />
      <rect x="13.25" y="3.75" width="7" height="7" rx="1.5" />
      <rect x="3.75" y="13.25" width="7" height="7" rx="1.5" />
      <rect x="13.25" y="13.25" width="7" height="7" rx="1.5" />
    </>
  ),
  // RTI / 耐热：温度计。球 + 管，与全组网格一致
  thermometer: (
    <>
      <path d="M10.25 13.9V5.75a1.75 1.75 0 0 1 3.5 0v8.15a3.5 3.5 0 1 1-3.5 0Z" />
      <path d="M12 16.5v-3" />
    </>
  ),
  // —— v0.1.6 新增（工具集扩展）。全部沿用 24 网格 / 1.75 描边，
  //    与既有 18 个同一套语汇：几何化、不开圆角、不用填充块。 ——
  // 单位换算：直尺
  ruler: (
    <>
      <path d="M3.9 14.6 14.6 3.9a1.5 1.5 0 0 1 2.1 0l3.4 3.4a1.5 1.5 0 0 1 0 2.1L9.4 20.1a1.5 1.5 0 0 1-2.1 0l-3.4-3.4a1.5 1.5 0 0 1 0-2.1Z" />
      <path d="m7.5 11 1.8 1.8" />
      <path d="m10.2 8.3 1.8 1.8" />
      <path d="m12.9 5.6 1.8 1.8" />
    </>
  ),
  // 编解码：花括号（Base64 / URL 这类"把一串东西换个壳"的通用符号）
  braces: (
    <>
      <path d="M9.5 3.75c-1.6 0-2.5.9-2.5 2.5v2.6c0 1.3-.7 2.1-2 2.15v2c1.3.05 2 .85 2 2.15v2.6c0 1.6.9 2.5 2.5 2.5" />
      <path d="M14.5 3.75c1.6 0 2.5.9 2.5 2.5v2.6c0 1.3.7 2.1 2 2.15v2c-1.3.05-2 .85-2 2.15v2.6c0 1.6-.9 2.5-2.5 2.5" />
    </>
  ),
  // 正则：斜杠包裹 + 一个跟随星号
  regex: (
    <>
      <path d="M8.2 4.5 4.5 19.5" />
      <path d="M19.5 4.5l-3.7 15" />
      <path d="M12 9.25v5" />
      <path d="M9.8 10.5 14.2 13" />
      <path d="M14.2 10.5 9.8 13" />
    </>
  ),
  // 日期：日历
  calendar: (
    <>
      <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.75" />
      <path d="M3.75 9.75h16.5" />
      <path d="M8.25 3.5v3.5" />
      <path d="M15.75 3.5v3.5" />
    </>
  ),
  // 数制：井号
  hash: (
    <>
      <path d="M9.25 3.75 7.75 20.25" />
      <path d="M16.25 3.75l-1.5 16.5" />
      <path d="M4.5 9h15" />
      <path d="M3.9 15h15" />
    </>
  ),
  // 校验码：盾 + 勾
  shield: (
    <>
      <path d="M12 3.75 5.25 6.4v5.35c0 4.05 2.75 7.5 6.75 8.5 4-1 6.75-4.45 6.75-8.5V6.4L12 3.75Z" />
      <path d="m9.4 12.1 1.8 1.8 3.4-3.4" />
    </>
  ),
  // 统计：柱状图
  chart: (
    <>
      <path d="M4.25 20.25h15.5" />
      <path d="M7 20.25V12.5" />
      <path d="M12 20.25V6.5" />
      <path d="M17 20.25v-5" />
    </>
  ),
  // 优先级：旗
  flag: (
    <>
      <path d="M6.25 20.5V4.25" />
      <path d="M6.25 5h10.5l-1.6 3.6 1.6 3.6H6.25" />
    </>
  ),
  // 对比 / diff：两栏
  columns: (
    <>
      <rect x="3.75" y="4.25" width="16.5" height="15.5" rx="1.75" />
      <path d="M12 4.25v15.5" />
    </>
  ),
  // 过滤：漏斗
  filter: (
    <>
      <path d="M4.25 5.25h15.5l-6 6.6v5.9l-3.5 1.6v-7.5l-6-6.6Z" />
    </>
  ),
  // 预览：眼睛
  eye: (
    <>
      <path d="M2.75 12S6 6.25 12 6.25 21.25 12 21.25 12 18 17.75 12 17.75 2.75 12 2.75 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  // 外联：地球（会联网的工具必备的自觉标记）
  globe: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5" />
      <path d="M12 3.75c2.2 2.4 3.3 5.2 3.3 8.25S14.2 18.6 12 20.25c-2.2-1.65-3.3-5.2-3.3-8.25S9.8 6.15 12 3.75Z" />
    </>
  ),
  // 导出：向外的箭头 + 底座
  upload: (
    <>
      <path d="M12 16.25V4.75" />
      <path d="m7.75 9 4.25-4.25L16.25 9" />
      <path d="M4.5 15.5v2.75a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15.5" />
    </>
  ),
  // 时钟（"最近使用"的标记）
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
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
