import { useEffect, useMemo, useRef, useState } from 'react';
import { parseQuickInput } from '../lib/todoParser';
import { PRIORITY_LABELS } from '../lib/sortFilter';
import { priorityClass } from '../lib/priority.js';
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
    // 优先级 chip 用「中文分级 (文件记号)」：既读得出急慢，也能对上 todo.txt。
    // 其余 chip 仍是文件里的原文写法（due: / star:1 / @分类）。
    all.push({
      key: 'p',
      // 写入行仍抄原文「高 (A)」，但徽章档位形状跟着一起走，四档在输入时就读得出急缓。
      cls: `chip chip-priority ${priorityClass(parsed.priority)}`,
      mark: priorityClass(parsed.priority),
      label: `${PRIORITY_LABELS[parsed.priority] || parsed.priority} (${parsed.priority})`,
    });
  }
  parsed.contexts.forEach((c) => all.push({ key: `c-${c}`, cls: 'chip chip-context', label: `@${c}` }));
  parsed.projects.forEach((p) => all.push({ key: `p-${p}`, cls: 'chip chip-project', label: `+${p}` }));
  if (parsed.dueDate) all.push({ key: 'd', cls: 'chip chip-date', label: `due:${parsed.dueDate}` });
  if (parsed.thresholdDate) {
    all.push({ key: 't', cls: 'chip chip-date', label: `t:${parsed.thresholdDate}` });
  }
  if (parsed.starValue) all.push({ key: 's', cls: 'chip chip-star', label: `star:${parsed.starValue}` });
  parsed.extraTags.forEach((t, i) => {
    all.push({ key: `x-${i}`, cls: 'chip chip-star', label: `${t.key}:${t.value}` });
  });
  const shown = all.slice(0, MAX_QUICK_CHIPS);
  return { all, shown, extra: all.length - shown.length };
}

// 快速添加：内联语法实时解析为 chip 预览，回车创建，输入框保持聚焦。
// seed = { text, seq }：日历双击日期 / Enter / 「新建」时预填 `due:YYYY-MM-DD ` 并聚焦。
// seq 让"同一个日期的第二次新建"也是一次新对象，effect 会重新预填。
export default function QuickAdd({ store, inputRef, seed = null, resetKey = 0 }) {
  const [text, setText] = useState(() => (seed ? seed.text : ''));
  const lastReset = useRef(resetKey);

  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    if (inputRef && inputRef.current) inputRef.current.focus();
    // inputRef 是 store 上的稳定 ref，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // 布局从日历切走时清掉预填的 due: —— QuickAdd 挂在条件渲染之外、不卸载，
  // 否则那行 `due:YYYY-MM-DD ` 会跟着进列表，用户一回车就写进 todo.txt。
  // 刻意不抢焦点：键盘用户可能正在侧栏或搜索框里。
  useEffect(() => {
    if (resetKey !== lastReset.current) {
      lastReset.current = resetKey;
      setText('');
    }
  }, [resetKey]);

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

  // 这条会写进 todo.txt 的下一行 —— 行号是真实计数，不是装饰。
  const nextLine = String((store.todoEntries?.length ?? 0) + 1).padStart(2, '0');

  return (
    <form className="quick-add" onSubmit={submit}>
      <span className="plus">
        <Icon name="plus" size={16} />
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="添加任务，回车创建"
        title="支持 @分类 +项目 due:日期 t:日期 (A)=高 star:1"
      />
      {/* 语法提示从占位文字里挪到右端：占位文字一长，第一眼就不知道这一行是干什么的。
          它只在不输入时出现，输入后让位给 chips 预览。 */}
      {!text && !parsed && (
        <span className="quick-add-hint" aria-hidden="true">
          @分类 +项目 due:日期 (A)
        </span>
      )}
      {parsed && (
        <div className="chips" data-line={nextLine}>
          {shown.map((c) => (
            <span key={c.key} className={c.cls}>
              {c.mark && <i className={`prio-mark ${c.mark}`} aria-hidden="true" />}
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
