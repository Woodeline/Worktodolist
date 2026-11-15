// 列表展示层过滤：把以 @ 开头的词从「显示文本」里摘掉，仅此而已。
//
// 解析器只认 `@合法名`（末尾须是字母 / 数字 / 下划线，见 todoParser.js 的
// CONTEXT_RE）。像 `@****` 这类不匹配规则的词不会被收进 contexts，而是原样
// 留在 task.title 里；所以除了不再渲染 @分类 徽章，标题本身也要在展示时过滤。
//
// 关键：这里不写回任何字段。task.title / task.raw / task.contexts 全部保持原值，
// serializeTask 仍会把 @分类 拼回文件，搜索仍按 raw 命中 —— 只是列表上不显示。
export function displayTitle(title) {
  if (typeof title !== 'string' || title.length === 0) return '';
  return title
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('@'))
    .join(' ')
    .trim();
}
