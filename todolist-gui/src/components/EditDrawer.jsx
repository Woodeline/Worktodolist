import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RECURRENCE_CHOICES, describeRecurrence } from '../lib/recurrence';
import { computeTagMenuPlacement } from '../lib/placement.js';
import { PRIORITY_LABELS, sidebarStats } from '../lib/sortFilter';
import { priorityClass } from '../lib/priority';
import { buildNesting, childrenOf } from '../lib/subtasks.js';
import { describeDueRel, formatDateShort, isDueOverdue } from '../lib/dateField.js';
import { nextInTrap, pickRestoreTarget, queryFocusable } from '../lib/focusTrap.js';
import DateField from './DateField.jsx';
import Icon from './Icon.jsx';

// 子任务区块。
//
// 放在编辑浮窗里而不是列表行上：加子任务是"停下来想一想"的动作，不是一个顺手的点击 ——
// 列表行上每多一个入口，误触的代价就多一分。这里同时能看见全部子任务，
// 加完就能核对，不必回到列表里找它们缩进在哪。
function SubtaskField({ store, task }) {
  const [text, setText] = useState('');
  // 「添加子任务」平时是一条加号线；点它才长出输入框 —— 清单是"看"的地方，
  // 常驻一个空输入框会让这块读起来像还没填完的表单。
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const cancelEditRef = useRef(false);
  const nesting = useMemo(
    () => buildNesting([...(store.todoEntries || []), ...(store.doneEntries || [])]),
    [store.todoEntries, store.doneEntries]
  );
  const kids = childrenOf(nesting, task.stableId);
  const doneCount = kids.filter((k) => k.completed).length;
  const pct = kids.length ? Math.round((doneCount / kids.length) * 100) : 0;

  const add = () => {
    const title = text.trim();
    if (!title) return;
    store.addSubtask(task.id, title);
    setText('');
  };

  const startEdit = (k) => {
    cancelEditRef.current = false;
    setEditingId(k.id);
    setEditText(k.title);
  };

  // 输入框只在失焦时提交一次：回车 / Esc 都主动 blur，避免两条路径各写一次文件。
  const commitEdit = () => {
    const id = editingId;
    const next = editText.trim();
    const original = kids.find((k) => k.id === id);
    const cancelled = cancelEditRef.current;
    cancelEditRef.current = false;
    setEditingId(null);
    setEditText('');
    if (cancelled || !id || !original || !next || next === original.title) return;
    store.updateTask(id, { title: next });
  };

  const onEditKeyDown = (e) => {
    // 回车是「改完这一条」，Esc 是「不改了」；两者都不能漏到浮窗的保存 / 关闭上。
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditRef.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <div className="drawer-block">
      <div className="drawer-bhead">
        <span className="drawer-key">子任务</span>
        {/* 计数是一条读数：走等宽族，与列表里的 1/2 同一支笔。 */}
        {kids.length > 0 && (
          <span className="subtask-count">
            {doneCount}/{kids.length}
          </span>
        )}
        <span className="drawer-bhead-sp" />
        {kids.length > 0 && (
          <div className="subtask-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <ul className="subtask-list">
          {kids.map((k) => {
            // 完成走 store 的退场窗口；勾与删除线先「演」出来，不然点一下要等一帧才有反馈。
            const done = k.completed || (store.fadingIds || []).includes(k.id);
            return (
              <li key={k.id}>
                <button
                  type="button"
                  className={`checkbox${done ? ' checked' : ''}`}
                  // 别让 mousedown 抢先让标题输入框失焦：否则 onBlur 会先写一次
                  // 标题、再执行本按钮，删除/完成变成两次落盘且用户毫无感知。
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingId === k.id) commitEdit();
                    store.toggleComplete(k);
                  }}
                  aria-label={done ? '取消完成子任务' : '完成子任务'}
                />
                {editingId === k.id ? (
                  <input
                    className="subtask-title-input"
                    value={editText}
                    autoFocus
                    aria-label="编辑子任务"
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={onEditKeyDown}
                    onBlur={commitEdit}
                  />
                ) : (
                  <span
                    className={'subtask-title' + (done ? ' completed' : '')}
                    onClick={() => startEdit(k)}
                    title="点击编辑"
                  >
                    {k.title}
                  </span>
                )}
                <button
                  type="button"
                  className="subtask-del"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingId === k.id) commitEdit();
                    store.deleteTask(k);
                  }}
                  title="删除子任务"
                  aria-label={`删除子任务 ${k.title}`}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <div className="subtask-add">
          <input
            type="text"
            value={text}
            placeholder="添加子任务"
            aria-label="添加子任务"
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 回车在这里是"加一条"，不是"保存整个浮窗" —— 不拦住的话
              // 每加一个子任务都会顺手把浮窗关掉。加完留在输入态，连着加不必再点一次。
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                add();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setText('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              add();
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button type="button" className="subtask-addline" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          <span>添加子任务</span>
        </button>
      )}
    </div>
  );
}

// 优先级刻度尺的段序：从低到高（无 → 低 → 中 → 高），与尺子的读法一致。
const PRIORITY_ORDER = ['C', 'B', 'A'];

function toList(text, prefix) {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith(prefix) ? s.slice(1) : s))
    .filter(Boolean);
}

// @分类 / +标签 字段：已选的值是一排胶囊（点 × 移除），「+分类」点开一条下划线输入
// 手打新值（回车提交、可连打），最右一枚小箭头展开**已保存**的候选清单，点候选即勾选/取消。
// 胶囊、手输、候选写回同一个逗号分隔的字符串，只有一份真相。
//
// 清单用 createPortal 挂到 body：它原来绝对定位在 .drawer-body 里，向上翻时
// 顶部一行会被那个 overflow-y:auto 的滚动容器裁掉，还把上方两行字段整片盖住。
// 挂出去之后按实测空间决定上下方向、收缩高度并自身滚动，首行永远完整可见。
function TagField({
  label,
  prefix,
  placeholder,
  value,
  onChange,
  options,
  emptyHint,
  hideLabel = false,
  className = '',
  addLabel,
  dot = false,
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const selected = toList(value, prefix);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      // 清单挂在 body 上，不在 boxRef 内，必须单独放行：
      // 否则 mousedown 先把菜单收掉，随后的 click 就落空了。
      if (boxRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 捕获阶段：候选清单的 Esc 只收清单，不把整个编辑浮窗一起关掉。
      e.stopPropagation();
      setOpen(false);
    };
    const onDismiss = () => setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    onChange(next.join(', '));
  };

  // 手打提交：逗号 / 空格分隔一次加多个，去重后并入已选；提交后清空但留在输入态。
  const commitDraft = () => {
    const names = toList(draft, prefix);
    if (names.length) {
      const next = [...selected];
      for (const n of names) if (!next.includes(n)) next.push(n);
      onChange(next.join(', '));
    }
    setDraft('');
  };

  // 先量后放：下方不够才向上翻，两个方向都夹在视口内（纯函数见 lib/placement.js）。
  const openMenu = () => {
    const box = boxRef.current;
    if (!box) return;
    setPlacement(
      computeTagMenuPlacement(box.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
    setOpen(true);
  };

  // 焦点落在清单里时，Tab 在清单内部循环，不让它穿到浮窗背后。
  // React Portal 的事件会沿组件树冒泡到 .edit-window，所以这里必须截断，
  // 否则浮窗自己的 Tab 陷阱会把焦点抢回表单里。
  const onMenuKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const items = menuRef.current ? queryFocusable(menuRef.current) : [];
    if (items.length === 0) return;
    e.stopPropagation();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // 先算成变量再挂到根节点：静态门禁按模板反引号配对取值，
  // 直接在属性里拼模板会让扫描器把后面的 JSX 一起吞成伪类名。
  const rootClass = 'field field-tags' + (className ? ' ' + className : '');

  return (
    <div className={rootClass} ref={boxRef}>
      {hideLabel ? null : <span>{label}</span>}
      <div className="tag-chips">
        {selected.map((name) => (
          <span className="chip" key={name}>
            {dot && <i className="chip-dot" aria-hidden="true" />}
            <b>
              {prefix}
              {name}
            </b>
            <button type="button" aria-label={`移除 ${prefix}${name}`} onClick={() => toggle(name)}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="chip-input"
            value={draft}
            placeholder={placeholder}
            aria-label={`添加${label}`}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commitDraft();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              commitDraft();
              setAdding(false);
            }}
          />
        ) : (
          <button type="button" className="chip-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} />
            <span>{addLabel || label}</span>
          </button>
        )}
        <button
          type="button"
          className={'chip-add is-icon' + (open ? ' is-open' : '')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`展开${label}候选`}
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </div>
      {open && placement && typeof document !== 'undefined' && createPortal(
        <div
          className="tag-menu"
          ref={menuRef}
          role="listbox"
          onKeyDown={onMenuKeyDown}
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
          {options.length === 0 ? (
            <div className="tag-menu-empty">{emptyHint}</div>
          ) : (
            options.map(({ name, count }) => {
              const on = selected.includes(name);
              return (
                <button
                  type="button"
                  key={name}
                  role="option"
                  aria-selected={on}
                  className={'tag-option' + (on ? ' sel' : '')}
                  onClick={() => toggle(name)}
                >
                  <span className="tag-option-check">
                    {on ? <Icon name="check" size={16} /> : null}
                  </span>
                  <span className="tag-option-name">
                    {prefix}
                    {name}
                  </span>
                  {count != null && <span className="count">{count}</span>}
                </button>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// 重复档位：自绘单选下拉。
//
// 为什么不用原生 select：它的**弹出层由系统绘制**（macOS 上是深灰长菜单 + 系统对勾），
// 既不认本项目的明暗令牌，也和这扇「一页纸」浮窗完全两个语气 —— 一展开，整页像被人贴了
// 一张别处的截图。这里换成与 @分类 / +标签 候选清单同一套外观（.tag-menu / .tag-option）
// 和同一套先量后放（computeTagMenuPlacement）：菜单挂 body 不被滚动区裁切，选中项打勾，
// 触发器仍是一枚凹槽控件（同高、同底、同描边，与隔壁输入框齐平）。
//
// 键盘：触发器 ↑ / ↓ 展开；菜单里 ↑↓ Home End 移动、Enter / Space 选定（button 原生语义）、
// Tab 关闭并把焦点交给触发器的下 / 上一个控件 —— 单选选完就走，不像多选清单那样把 Tab 困住。
function SelectField({ label, value, options, onChange, containerRef, hideLabel = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const current = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      // 菜单挂在 body 上，不在 boxRef 内，必须单独放行：否则 mousedown 先把菜单收掉，
      // 随后的 click 就落空了。
      if (boxRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 捕获阶段：菜单的 Esc 只收菜单，不把整个编辑浮窗一起关掉。
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDismiss = () => setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  // 打开后焦点落在当前档上：键盘用户不必再按一次方向键才知道自己在哪一档。
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const target = menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]');
    if (target) target.focus();
  }, [open]);

  // 先量后放：高度按实际档位估算，别用统一上限 —— 否则四个档位的小菜单明明放得下，
  // 也会因为「下方不如上方宽裕」被翻到触发器头顶。
  const openMenu = () => {
    const box = boxRef.current;
    if (!box) return;
    setPlacement(
      computeTagMenuPlacement(
        box.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        options.length * 28 + 12
      )
    );
    setOpen(true);
  };

  const choose = (next) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    openMenu();
  };

  const onMenuKeyDown = (e) => {
    if (e.key === 'Tab') {
      // 单选选完就走：关菜单，再把焦点交给**触发器**的下 / 上一个控件。
      // 落点自己算，不交给浏览器的默认 Tab —— 菜单挂在 body 末尾，
      // 浏览器的默认行为会从「菜单项」起算，Shift+Tab 会一路退到「保存」。
      const target = nextInTrap(queryFocusable(containerRef?.current), triggerRef.current, e.shiftKey);
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      if (target) target.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // 显式激活：不依赖「button 对 Enter 的默认激活」—— 那条路径在长按 / 输入法
      // 组合下偶尔不触发，而这里按一下就该定下来，落了空会让人以为菜单坏了。
      e.preventDefault();
      e.stopPropagation();
      const cur = document.activeElement;
      if (cur && cur.getAttribute('role') === 'option') cur.click();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = menuRef.current ? Array.from(menuRef.current.querySelectorAll('[role="option"]')) : [];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next =
      e.key === 'Home'
        ? items[0]
        : e.key === 'End'
          ? items[items.length - 1]
          : e.key === 'ArrowDown'
            ? items[Math.min(items.length - 1, at + 1)]
            : items[Math.max(0, at - 1)];
    if (next) next.focus();
  };

  const rootClass = 'field field-select' + (className ? ' ' + className : '');

  return (
    <div className={rootClass} ref={boxRef}>
      {hideLabel ? null : <span>{label}</span>}
      <button
        type="button"
        className={'select-trigger' + (open ? ' is-open' : '')}
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="select-value">{current ? current.label : ''}</span>
        <span className="select-caret">
          <Icon name="chevron-down" size={16} />
        </span>
      </button>
      {open && placement && typeof document !== 'undefined' && createPortal(
        <div
          className="tag-menu"
          ref={menuRef}
          role="listbox"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{
            top: placement.top,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                type="button"
                key={o.value || 'none'}
                role="option"
                aria-selected={on}
                className={'tag-option' + (on ? ' sel' : '')}
                onClick={() => choose(o.value)}
              >
                <span className="tag-option-check">{on ? <Icon name="check" size={16} /> : null}</span>
                <span className="tag-option-name">{o.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

// 日期字段已抽成独立组件 ./DateField.jsx：编辑浮窗、提议弹窗、批量工具共用同一套
// 短日期读数 / 自绘弹层 / 清除 / 快捷预设，避免三处口径再次分叉。

/** 备注正文（备注存在 notes.md 里，不在 todo.txt 的行上）。store 缺这个能力时当没备注。 */
function noteOf(store, stableId) {
  if (!stableId || typeof store.getNote !== 'function') return '';
  return store.getNote(stableId) || '';
}

// 表单初始值：把一条任务摊平成表单字段。
//
// 它同时是「表单的初始状态」—— 不再走「先渲染空壳、再在 effect 里 setState」那条路。
// 那条路要求组件在 form 还是 null 时提前 return，而提前 return 会**跳过后面的 Hooks**，
// 于是在「没在编辑 → 正在编辑」这一次切换里 Hook 数量从 3 个变成 4 个，React 直接抛
// "Rendered more hooks than during the previous render."，整棵树被卸载（白屏 + 点哪都没反应）。
// v1.1.0 在 Windows 上「点编辑就卡死且看不到界面」就是这个。
function formFromTask(task, store) {
  return {
    title: task.title,
    priority: task.priority || '',
    dueDate: task.dueDate || '',
    remindAt: task.remindAt || '',
    recurrence: task.recurrence || '',
    note: noteOf(store, task.stableId),
    contexts: task.contexts.join(', '),
    projects: task.projects.join(', '),
    starred: Boolean(task.starValue),
  };
}

/**
 * 编辑浮窗（外壳）。
 *
 * 只回答一个问题：现在有没有正在编辑的任务。没有就整体不挂载 ——
 * 于是表单组件**只在真的要编辑时才 mount**，它的初始状态能用 useState 直接算出来，
 * 不需要「空壳渲染一次 + effect 里补状态」这种会改变 Hook 数量的写法。
 *
 * Hooks 的数量必须在组件的每一次渲染里恒定，这不是风格问题：少一个多一个，
 * React 就认为前后两次渲染不是同一个组件，直接抛错并卸载整棵树。
 */
export default function EditDrawer({ store }) {
  const task = store.editingTask;
  if (!task) return null;
  // key 让「从 A 直接切到 B」也重新初始化一次表单，否则会留着上一条的标题。
  return <EditForm key={task.id} task={task} store={store} />;
}

/**
 * 表单指纹：只取 save() 真正会写回文件的那些字段。
 * 用途是「有没有改动」这一条读数 —— 分类 / 标签先按逗号归一，
 * 否则多敲一个空格也会点亮「未保存」，提示就失去意义。
 * 提成纯函数是为了能被单测锁住：它必须和 save() 提交的字段同源。
 */
export function formSignature(form) {
  return JSON.stringify([
    form.title.trim(),
    form.priority,
    form.dueDate,
    form.remindAt,
    form.recurrence,
    toList(form.contexts, '@').join(','),
    toList(form.projects, '+').join(','),
    form.note,
    Boolean(form.starred),
  ]);
}

function EditForm({ task, store }) {
  const [form, setForm] = useState(() => formFromTask(task, store));
  const [editingNote, setEditingNote] = useState(false);
  // 空标题守卫：todo.txt 的行首就是标题，清空标题保存会写出一行只剩属性的空任务 ——
  // 它不再显示任何文字，只能靠 id: 找回来。所以保存前拦一道，并把标题框标成危险态。
  const [titleError, setTitleError] = useState(false);
  // 删除的二次确认：这个浮窗里没有撤销，误触一次就是一条记录没了。
  const [deleteArmed, setDeleteArmed] = useState(false);
  // 关闭前的放弃确认：只在真的改过东西时才多问一句，没改就直接关，不添步数。
  const [discardAsk, setDiscardAsk] = useState(false);
  const winRef = useRef(null);
  const titleRef = useRef(null);
  const prioRef = useRef(null);
  const confirmRef = useRef(null);
  // 打开时的指纹。惰性算一次就够（表单的初始值此后不会再回到"原始态"）。
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = formSignature(form);

  // 已保存的分类 / 标签候选：复用侧栏统计，取的就是 todo.txt 里的真实值。
  const { contexts: contextOptions, projects: projectOptions } = useMemo(
    () => sidebarStats(store.todoEntries || []),
    [store.todoEntries]
  );

  // 焦点契约（与 useHotkeys 的「编辑时禁用全局快捷键」配套）：
  // ① 关闭（卸载）时把焦点还给来源那一行；来源行正在退场（刚在浮窗里被删除）
  //    或已经不在文档里，就顺延到相邻的活行，再不行退回快速添加框 ——
  //    绝不撒手让焦点落到 body：那之后按 Tab 会从工具栏第一个按钮开始，
  //    用户看到的就是「焦点跑进了工具栏」；
  // ② Tab / Shift+Tab 在浮窗内循环，不穿透到背后的列表（陷阱逻辑见 lib/focusTrap.js）。
  // 注意：这必须是 useEffect 里的清理函数 —— 只在真的编辑时 mount 的组件，
  // 它的卸载时机就是「浮窗关闭」的唯一真相。
  // deps 只留 task.id：store 每次渲染都是新对象，但它身上的 quickAddRef 是
  // 稳定 ref，清理时读 .current 拿到的就是当前那个输入框。
  useEffect(
    () => () => {
      const origin = document.querySelector(`.task-row[data-task-id="${task.id}"]`);
      const allRows = Array.from(document.querySelectorAll('.task-row'));
      const quickAdd = store.quickAddRef && store.quickAddRef.current;
      const target = pickRestoreTarget(origin, allRows, quickAdd);
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    },
    [task.id]
  );

  const priorities = [...PRIORITY_ORDER];
  if (task.priority && !priorities.includes(task.priority)) priorities.push(task.priority);

  // 优先级四档（含「无」与手写的非标准档）：分段控件的段序就是这里的顺序。
  const prioOptions = [
    { value: '', label: '无', cls: 'prio-none' },
    ...priorities.map((p) => ({ value: p, label: PRIORITY_LABELS[p] || p, cls: priorityClass(p) })),
  ];
  const prioIndex = Math.max(
    0,
    prioOptions.findIndex((o) => o.value === form.priority)
  );

  // roving tabindex：整组只停一次 Tab，←/→（以及 ↑/↓、Home/End）换档并同步移动焦点。
  // 这是 radiogroup 的标准行为；四颗各自可 Tab 的按钮会让"跳过这组"变成四次按键。
  const onPriorityKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = null;
    if (step) next = (prioIndex + step + prioOptions.length) % prioOptions.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = prioOptions.length - 1;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setForm((f) => ({ ...f, priority: prioOptions[next].value }));
    const btn = prioRef.current?.querySelectorAll('button')[next];
    if (btn) btn.focus();
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // 手写的规则（rec:+5d、rec:mon,wed）可能不在预设里，补一个选项进去，
  // 否则下拉框会显示成空 —— 看起来像「没设重复」，实际设着。
  const recurrenceOptions = useMemo(() => {
    const cur = form.recurrence || '';
    if (!cur || RECURRENCE_CHOICES.some((c) => c.value === cur)) return RECURRENCE_CHOICES;
    return [...RECURRENCE_CHOICES, { value: cur, label: describeRecurrence(cur) || cur }];
  }, [form.recurrence]);

  // 读数条与刻度行共用同一份表单值：条上是摘要，行里是可编辑的控件。
  const dueRel = describeDueRel(form.dueDate);
  const dueOverdue = isDueOverdue(form.dueDate);
  const prioCurrent = prioOptions[prioIndex];
  const recCurrent =
    recurrenceOptions.find((o) => o.value === form.recurrence) || recurrenceOptions[0];

  // 读数条是捷径：点它去打开 / 聚焦对应那一行的控件，不另养第二份弹层状态。
  const jumpField = (field, selector) => {
    const el =
      winRef.current && winRef.current.querySelector('[data-field="' + field + '"] ' + selector);
    if (el) el.click();
  };
  const focusPrio = () => {
    const btn = prioRef.current && prioRef.current.querySelector('[aria-checked="true"]');
    if (btn) btn.focus();
  };

  // 「未保存」是一条读数，不是一句说明：只在真有改动时出现。
  const dirty = formSignature(form) !== initialRef.current;

  // 关闭的所有路径（Esc / 取消 / 点遮罩 / 右上角 ×）都经过这里：
  // 改过东西就多问一句，没改就直接关 —— 不给没改动的人添步数。
  const requestClose = () => {
    if (dirty) {
      setDiscardAsk(true);
      return;
    }
    store.closeEditor();
  };

  // 从「放弃修改？」退回表单：先把焦点交回浮窗，再卸掉这一层 ——
  // 否则被卸掉的那颗按钮会把焦点一起带走，用户下一次按 Tab 会从页面顶部开始。
  const closeDiscardAsk = () => {
    setDiscardAsk(false);
    winRef.current?.focus();
  };

  const save = async () => {
    // 只提交表单里有的字段；未列出的（如 t: 阈值日期）由 applyPatch 原样保留，
    // 编辑一次不该把已有数据抹掉。
    const title = form.title.trim();
    if (!title) {
      // 空标题不是一个可以保存的状态：拦下来、标红、把焦点送回标题框。
      // 保存按钮不禁用 —— 禁用只会让「点了没反应」变得没有解释。
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    store.updateTask(task.id, {
      title,
      priority: form.priority || null,
      dueDate: form.dueDate || null,
      remindAt: form.remindAt || null,
      recurrence: form.recurrence || null,
      contexts: toList(form.contexts, '@'),
      projects: toList(form.projects, '+'),
      starValue: form.starred ? '1' : null,
    });
    // 备注写在数据目录的 notes.md 里，不在 todo.txt 的行上 —— 它是异步写，
    // 但先关浮窗不等它：失败会自己弹 toast，而让人对着一个已经保存的任务等着没意义。
    if (form.note !== noteOf(store, task.stableId) && typeof store.saveNote === 'function') {
      store.saveNote(task.id, form.note);
    }
    // 关窗后补一条轻提示：改动写在文件里，但「今天」等多个视图下这一行可能不在本屏，
    // 没有反馈的话，「保存」和「没保存」在画面上是一样的。
    if (typeof store.showToast === 'function') store.showToast('已保存');
    store.closeEditor();
  };

  const remove = () => {
    store.deleteTask(task);
    store.closeEditor();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // 已进入待确认的删除：Esc 先撤掉那一步，而不是顺手把整个浮窗关掉。
      if (deleteArmed) {
        setDeleteArmed(false);
        return;
      }
      requestClose();
      return;
    }
    // Tab 焦点陷阱：到头循环，不让焦点穿过浮窗落到背后的列表上。
    if (e.key === 'Tab') {
      const target = nextInTrap(queryFocusable(winRef.current), document.activeElement, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
      return;
    }
    // 回车即确认保存；按钮上的回车留给按钮自身的语义（选中优先级等）。
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      save();
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) requestClose();
  };

  // 待确认的删除被「别处的操作」撤掉：点窗内任何非删除按钮、或点遮罩，都算反悔。
  const handleWindowMouseDown = (e) => {
    if (!deleteArmed) return;
    if (e.target.closest && e.target.closest('.drawer-delete')) return;
    setDeleteArmed(false);
  };

  return (
    <div className="modal" onMouseDown={handleBackdrop}>
      <div
        className="edit-window"
        role="dialog"
        aria-modal="true"
        aria-label="编辑任务"
        tabIndex={-1}
        ref={winRef}
        onKeyDown={handleKeyDown}
        onMouseDown={handleWindowMouseDown}
      >
        <div className="drawer-header">
          {/* 标题行：标题与关闭钮同处一行（2026-11-18 四改）。
              `id:` 与 `L行号` 那组文件坐标已撤（三改）—— 用户改的是任务，不是那一行的地址。
              关闭钮原先是独立一行，撤掉坐标后那行只剩一枚叉号，卡顶到标题之间空出 44px，
              读起来像少渲染了一行；现在两者共用一行，标题就是这张卡的第一行字。 */}
          <div className="drawer-headline">
            <input
              className={'drawer-title-input' + (titleError ? ' is-error' : '')}
              ref={titleRef}
              value={form.title}
              onChange={(e) => {
                if (titleError) setTitleError(false);
                set('title')(e);
              }}
              placeholder="任务标题"
              aria-label="任务标题"
              aria-invalid={titleError || undefined}
              autoFocus
            />
            <button className="drawer-close" onClick={requestClose} aria-label="关闭">
              <Icon name="x" size={16} />
            </button>
          </div>
          {/* 读数条：四个属性摘要常驻卡头，不滚走；点一枚去打开对应那一行的控件。 */}
          <div className="drawer-strip">
            <button
              type="button"
              className="drawer-read"
              onClick={focusPrio}
              aria-label={`优先级：${prioCurrent.label}`}
            >
              {prioCurrent.value ? (
                <Icon name="flag" size={14} className={'flag ' + prioCurrent.cls} />
              ) : null}
              <span>{prioCurrent.label}</span>
            </button>
            <button
              type="button"
              className={
                'drawer-read' + (dueOverdue ? ' is-overdue' : form.dueDate ? '' : ' is-empty')
              }
              onClick={() => jumpField('due', '.date-field-btn')}
              aria-label={`截止日期：${formatDateShort(form.dueDate) || '未设置'}`}
            >
              <Icon name="calendar" size={14} />
              <span className="drawer-num">{formatDateShort(form.dueDate) || '未设置'}</span>
              {dueRel ? <span className="drawer-read-rel">{dueRel}</span> : null}
            </button>
            <button
              type="button"
              className={'drawer-read' + (form.recurrence ? '' : ' is-empty')}
              onClick={() => jumpField('rec', '.select-trigger')}
              aria-label={`重复：${recCurrent.label}`}
            >
              <Icon name="repeat" size={14} />
              <span>{recCurrent.label}</span>
            </button>
            <button
              type="button"
              className={'drawer-read' + (form.remindAt ? '' : ' is-empty')}
              onClick={() => jumpField('rem', '.date-field-btn')}
              aria-label={`提醒时刻：${formatDateShort(form.remindAt, true) || '未设置'}`}
            >
              <Icon name="bell" size={14} />
              <span className="drawer-num">{formatDateShort(form.remindAt, true) || '未设置'}</span>
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {/* 刻度行：左列是刻度（10px mono），右列平时是读数、hover 才浮出可编辑的底。 */}
          <div className="drawer-rows">
            <div className="drawer-row" data-field="prio">
              <span className="drawer-key">优先级</span>
              {/* 刻度尺：一条基线 + 四档，选中档下方一道 2px 本色刻度。
                  它是「一个属性的四档」，roving tabindex 整组只停一次 Tab。 */}
              <div
                className="prio-ruler"
                role="radiogroup"
                aria-label="优先级"
                ref={prioRef}
                onKeyDown={onPriorityKeyDown}
              >
                {prioOptions.map((o) => (
                  <button
                    key={o.value || 'none'}
                    type="button"
                    role="radio"
                    aria-checked={form.priority === o.value}
                    tabIndex={form.priority === o.value ? 0 : -1}
                    className={o.cls + (form.priority === o.value ? ' sel' : '')}
                    onClick={() => setForm((f) => ({ ...f, priority: o.value }))}
                  >
                    {o.value ? <Icon name="flag" size={14} className={'flag ' + o.cls} /> : null}
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="drawer-row" data-field="rec">
              <span className="drawer-key">重复</span>
              <SelectField
                hideLabel
                className="drawer-cell"
                label="重复"
                value={form.recurrence}
                options={recurrenceOptions}
                onChange={(v) => setForm((f) => ({ ...f, recurrence: v }))}
                containerRef={winRef}
              />
            </div>

            <div className="drawer-row" data-field="due">
              <span className="drawer-key">截止</span>
              <DateField
                hideLabel
                className="drawer-cell"
                label="截止日期"
                value={form.dueDate}
                onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))}
                suffix={dueRel ? <span className="drawer-cell-rel">{dueRel}</span> : null}
              />
            </div>

            <div className="drawer-row" data-field="rem">
              <span className="drawer-key">提醒</span>
              <DateField
                hideLabel
                className="drawer-cell"
                withTime
                label="提醒时刻"
                value={form.remindAt}
                onChange={(v) => setForm((f) => ({ ...f, remindAt: v }))}
              />
            </div>

            <div className="drawer-row" data-field="ctx">
              <span className="drawer-key">分类</span>
              <TagField
                hideLabel
                className="drawer-cell"
                label="分类"
                addLabel="分类"
                prefix="@"
                placeholder="工作, 生活"
                value={form.contexts}
                onChange={(v) => setForm((f) => ({ ...f, contexts: v }))}
                options={contextOptions}
                emptyHint="暂无已保存的分类"
              />
            </div>

            <div className="drawer-row" data-field="prj">
              <span className="drawer-key">标签</span>
              <TagField
                hideLabel
                className="drawer-cell"
                dot
                label="标签"
                addLabel="标签"
                prefix="+"
                placeholder="回测, 量化"
                value={form.projects}
                onChange={(v) => setForm((f) => ({ ...f, projects: v }))}
                options={projectOptions}
                emptyHint="暂无已保存的标签"
              />
            </div>
          </div>

          <SubtaskField store={store} task={task} />

          <div className="drawer-block">
            <div className="drawer-bhead">
              <span className="drawer-key">备注</span>
              <span className="drawer-bhead-sp" />
              <button
                type="button"
                className="btn btn-ghost note-edit-btn"
                onClick={() => setEditingNote((v) => !v)}
              >
                <Icon name={editingNote ? 'check' : 'file'} size={12} />
                <span>{editingNote ? '完成' : form.note ? '编辑备注' : '添加备注'}</span>
              </button>
            </div>
            {editingNote ? (
              <div className="note-paper">
                <textarea
                  className="note-input"
                  rows={3}
                  value={form.note}
                  onChange={set('note')}
                  aria-label="备注正文"
                  autoFocus
                />
              </div>
            ) : form.note ? (
              <div className="note-paper note-display">
                <span className="note-clip">{form.note}</span>
              </div>
            ) : null}
          </div>

          {task.extraTags.length > 0 && (
            <div className="extra-tags">
              {task.extraTags.map((t, i) => (
                <span key={`${t.key}-${i}`} className="chip chip-star">
                  {t.key}:{t.value}
                </span>
              ))}
            </div>
          )}

        </div>

        <div className="drawer-actions">
          <button
            className={'btn btn-ghost is-danger drawer-delete' + (deleteArmed ? ' is-armed' : '')}
            onClick={() => {
              // 第一下只是把按钮换成「确认删除」，第二下才真的删 ——
              // 底栏这一格与「取消」只隔 8px，一次误触不该等于一条记录消失。
              if (!deleteArmed) {
                setDeleteArmed(true);
                return;
              }
              remove();
            }}
          >
            {deleteArmed ? '确认删除' : '删除'}
          </button>
          {/* 一条读数，不是一句说明：真有改动才出现，位置固定在删除右侧。 */}
          {dirty && (
            <span className="drawer-dirty" aria-live="polite">
              未保存
            </span>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={requestClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>

      {/* 放弃修改的确认：只在有改动时出现，且压在浮窗上再问一句。
          放在 .edit-window 之外是为了不继承它的 Tab 陷阱 —— 这一层只有两颗按钮，
          自己循环一次就够（否则 Tab 会穿到背后的列表上）。 */}
      {discardAsk && (
        <div
          className="drawer-confirm"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeDiscardAsk();
              return;
            }
            if (e.key === 'Tab') {
              const target = nextInTrap(
                queryFocusable(confirmRef.current),
                document.activeElement,
                e.shiftKey
              );
              if (target) {
                e.preventDefault();
                target.focus();
              }
            }
          }}
        >
          <div
            className="modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-label="放弃修改？"
            ref={confirmRef}
          >
            <h3>放弃修改？</h3>
            <p>这一条还有没保存的改动。关闭浮窗不会把它们写进 todo.txt。</p>
            <div className="modal-actions">
              {/* 破坏性的那个放左边、红字无框；绿色的「继续编辑」才是默认答案 ——
                  按下 Esc / 回车的人本来就该回到表单，而不是丢掉刚写的东西。 */}
              <button className="btn btn-ghost is-danger" onClick={() => store.closeEditor()}>
                放弃修改
              </button>
              <button className="btn btn-primary" autoFocus onClick={closeDiscardAsk}>
                继续编辑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
