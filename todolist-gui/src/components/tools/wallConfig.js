// 工具墙的外壳侧配置：分组色、分组注、预留卡规则。
//
// 与 registry.js 的分工：registry 只描述"工具是什么"（含 group 分组 id），
// 这里描述"墙怎么呈现分组"—— 颜色与文案都是表现层，留在外壳侧，
// registry 的契约（registry.test.js）因此不用动。
//
// 为什么是独立模块而不是写在 ToolsWall.jsx 里：scripts/qa-tools.mjs 要
// import 同一份常量来算期望值（卡片数 = 可见工具数 + 预留卡数）。
// .jsx 带 JSX，node 直接 import 不了；放进纯 JS 模块，实现与门禁同源，
// 不会出现"两边各写一份、迟早漂移"。

/** 组内工具数低于此值时，网格末尾渲染一张虚线预留卡；满额即隐藏。 */
export const RESERVED_SLOT_LIMIT = 4;

/** 分组色：只编码"归属"，不编码优先级。色相走既有语义令牌。 */
export const GROUP_TONES = {
  engineering: 'var(--accent)',
  todo: 'var(--ok)',
};

/** 分组注：区头右侧的一句灰色说明，不进 registry。 */
export const GROUP_NOTES = {
  engineering: '试验数据 → 寿命参数',
  todo: '读 todo.txt 只读投影',
};
