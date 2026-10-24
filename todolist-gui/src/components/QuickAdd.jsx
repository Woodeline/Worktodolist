import { useMemo, useState } from 'react';
import { parseQuickInput } from '../lib/todoParser';
import Icon from './Icon.jsx';

// 快速添加的 chips 预览一次最多露几个。
// 超过就折叠成 +N：旧的 overflow:hidden 是静默裁掉 —— 用户看不到解析结果，
// 还以为「@工作 +量化 due:…」没被解析上，其实只是被裁了。
export const MAX_QUICK_CHIPS = 3;

// 把解析结果摊成 chips 清单（纯函数：无 DOM、无 store，node 环境可直接单测）。
// 返回全部 + 可见的前 N 个 + 折叠计数，三份都来自同一个数组，不会各算各的。
export function quickChips(parsed) {
  if (!parsed) return { all: [], shown: [], extra: 0 };
  const all = [];
  if (parsed.priority) {
    all.push({ key: 'p', cls: 'chip chip-priority', label: `(${parsed.priority})` });
  }
  parsed.contexts.forEach((c) => all.push({ key: `c-${c}`, cls: 'chip chip-context', label: `@${c}` }));
  parsed.projects.forEach((p) => all.push({ key: `p-${p}`, cls: 'chip chip-project', label: `+${p}` }));
  if (parsed.dueDate) all.push({ key: 'd', cls: 'chip chip-date', label: `截止 ${parsed.dueDate}` });
  if (parsed.thresholdDate) {
    all.push({ key: 't', cls: 'chip chip-date', label: `阈值 ${parsed.thresholdDate}` });
  }
  if (parsed.starValue) all.push({ key: 's', cls: 'chip chip-star', label: '★' });
  parsed.extraTags.forEach((t, i) => {
    all.push({ key: `x-${i}`, cls: 'chip chip-star', label: `${t.key}:${t.value}` });
  });
  const shown = all.slice(0, MAX_QUICK_CHIPS);
  return { all, shown, extra: all.length - shown.length };
}

// 快速添加：内联语法实时解析为 chip 预览，回车创建，输入框保持聚焦
export default function QuickAdd({ store, inputRef }) {
  const [text, setText] = useState('');

  const parsed = useMemo(
    () => (text.trim() ? parseQuickInput(text) : null),
    [text]
  );
  const { shown, extra, all } = useMemo(() => quickChips(parsed), [parsed]);

  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    store.addTask(value);
    setText('');
  };

  return (
    <form className="quick-add" onSubmit={submit}>
      <span className="plus">
        <Icon name="plus" size={15} />
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="添加任务，回车创建"
        title="支持 @分类 +项目 due:日期 t:日期 (A) star:1"
      />
      {/* 语法提示从占位文字里挪到右端：占位文字一长，第一眼就不知道这一行是干什么的。
          它只在不输入时出现，输入后让位给 chips 预览。 */}
      {!text && !parsed && (
        <span className="quick-add-hint" aria-hidden="true">
          @分类 +项目 due:日期 (A)
        </span>
      )}
      {parsed && (
        <div className="chips">
          {shown.map((c) => (
            <span key={c.key} className={c.cls}>
              {c.label}
            </span>
          ))}
          {extra > 0 && (
            // 折叠指示：完整清单放悬停，列表上一眼能看到「还有几项没露」
            <span
              className="chip chip-more"
              title={`还有 ${extra} 项：${all.slice(MAX_QUICK_CHIPS).map((c) => c.label).join(' ')}`}
            >
              +{extra}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
