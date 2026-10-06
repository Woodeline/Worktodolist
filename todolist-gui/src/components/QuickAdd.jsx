import { useMemo, useState } from 'react';
import { parseQuickInput } from '../lib/todoParser';
import Icon from './Icon.jsx';

// 快速添加：内联语法实时解析为 chip 预览，回车创建，输入框保持聚焦
export default function QuickAdd({ store, inputRef }) {
  const [text, setText] = useState('');

  const parsed = useMemo(
    () => (text.trim() ? parseQuickInput(text) : null),
    [text]
  );

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
        placeholder="添加任务，回车创建（支持 @分类 +标签 due:日期 t:日期 (A) star:1）"
        title="快捷键 n 聚焦"
      />
      {parsed && (
        <div className="chips">
          {parsed.priority && <span className="chip chip-priority">({parsed.priority})</span>}
          {parsed.contexts.map((c) => (
            <span key={`c-${c}`} className="chip chip-context">
              @{c}
            </span>
          ))}
          {parsed.projects.map((p) => (
            <span key={`p-${p}`} className="chip chip-project">
              +{p}
            </span>
          ))}
          {parsed.dueDate && <span className="chip chip-date">截止 {parsed.dueDate}</span>}
          {parsed.thresholdDate && <span className="chip chip-date">阈值 {parsed.thresholdDate}</span>}
          {parsed.starValue && <span className="chip chip-star">★</span>}
          {parsed.extraTags.map((t, i) => (
            <span key={`t-${i}`} className="chip chip-star">
              {t.key}:{t.value}
            </span>
          ))}
        </div>
      )}
    </form>
  );
}
