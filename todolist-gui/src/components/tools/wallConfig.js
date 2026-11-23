// 工具墙的外壳侧配置：预留卡规则。
//
// 与 registry.js 的分工：registry 只描述"工具是什么"（含 group 分组 id），
// 这里描述"墙怎么呈现分组"。
//
// 为什么是独立模块而不是写在 ToolsWall.jsx 里：scripts/qa-tools.mjs 要
// import 同一份常量来算期望值（卡片数 = 可见工具数 + 预留卡数）。
// .jsx 带 JSX，node 直接 import 不了；放进纯 JS 模块，实现与门禁同源，
// 不会出现"两边各写一份、迟早漂移"。

/** 组内工具数低于此值时，网格末尾渲染一张虚线预留卡；满额即隐藏。 */
export const RESERVED_SLOT_LIMIT = 4;
