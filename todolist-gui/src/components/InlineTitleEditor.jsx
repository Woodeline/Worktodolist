import { useEffect, useRef, useState } from 'react';

// 任务标题的行内编辑（慢速双击进入）。
//
// 拆成独立组件而不是塞进 TaskRow 的条件渲染：输入框自己要 focus / select，
// 而 TaskRow 的「选中行接管焦点」effect 会在同一次提交里抢焦点 —— 子组件里
// 加一道守卫比在父组件里互相猜顺序稳。提交权交给父组件，这里只收文本。
export default function InlineTitleEditor({ value, onCommit, onCancel }) {
  const [draft, setDraft] = useState(() => value);
  const inputRef = useRef(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 光标落到末尾；不整段选中 —— 编辑浮窗里的子任务行内编辑也不铺选区，
    // 一进来就一块深色高亮会把标题本身盖住。
    try {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } catch {
      // 非文本输入不支持选区时忽略
    }
  }, []);

  // Enter / Esc / 失焦可能在同一轮里连着来（Esc 会让输入框卸载），
  // doneRef 保证 onCommit / onCancel 只走一次，不重复写文件。
  const finish = (commit) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="row-title-input"
      type="text"
      value={draft}
      aria-label="编辑任务标题"
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 全局快捷键挂在 window 上：不截断的话，e / Enter 会顺手把编辑浮窗也打开。
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
