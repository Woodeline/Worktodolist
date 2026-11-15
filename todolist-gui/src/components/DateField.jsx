// 统一的日期 / 时刻设定控件。
//
// 取代原来的「中文按钮 + 隐藏原生 input + showPicker()」：原生弹层由 WebView 渲染，
// 不吃项目 CSS 令牌、暗色契约与 CDP 截图都管不到，也没有清除入口和可用的 aria。
// 现在弹层是真 DOM，用 react-day-picker 提供 roving tabindex / 方向键 / 完整日期
// accessible name 这套 WAI-ARIA 行为，视觉全部由项目令牌覆盖。
//
// 值形状不变（lib/dateField.js）：due 是 YYYY-MM-DD，rem 是 YYYY-MM-DDTHH:mm。
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker } from '@daypicker/react';
import { zhCN } from '@daypicker/react/locale/zh-CN';
import '@daypicker/react/style.css';
import Icon from './Icon.jsx';
import { queryFocusable } from '../lib/focusTrap.js';
import {
  DEFAULT_TIME,
  formatDateShort,
  formatDateValue,
  makePresets,
  parseDateValue,
} from '../lib/dateField.js';

export default function DateField({
  label,
  value,
  onChange,
  withTime = false,
  placeholder = '未设置',
  hideLabel = false,
  className = '',
}) {
  // 所有 Hook 无条件调用：弹层开关只影响渲染分支，不影响 Hook 数量。
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogId = useId();

  const { date, time } = parseDateValue(value);
  const display = formatDateShort(value, withTime);
  const presets = makePresets(date || new Date());

  const commit = (nextDate, nextTime) => {
    onChange(formatDateValue(nextDate, nextTime, withTime));
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setAnchor({ left: r.left, top: r.top, bottom: r.bottom });
    }
    setOpen((v) => !v);
  };
  const selectDay = (d) => {
    if (!d) return;
    commit(d, withTime ? (time || DEFAULT_TIME) : '');
    close();
  };
  const clear = () => {
    onChange('');
    close();
  };
  const setTime = (t) => {
    if (date) commit(date, t);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      // 弹层挂在 body 上，不在 rootRef 内，必须单独放行
      if (rootRef.current?.contains(e.target) || dialogRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    // 捕获阶段：抢在编辑浮窗自己的 Escape（关闭整个浮窗）之前
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const onDialogKeyDown = (e) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = queryFocusable(dialogRef.current);
    if (!items.length) return;
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
  const rootClass = className ? 'date-field ' + className : 'date-field';

  // 弹层挂到 body，避开编辑浮窗 .drawer-body 的 overflow-y: auto 裁切。
  // 下方空间不够就翻到字段上方；宽度按日格数固定，窄边再夹进视口。
  const POPOVER_W = 288;
  const POPOVER_H = withTime ? 356 : 312;
  const popoverStyle = anchor ? {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_W - 8)),
    top: anchor.bottom + 4 + POPOVER_H > window.innerHeight - 8
      ? Math.max(8, anchor.top - POPOVER_H - 4)
      : anchor.bottom + 4,
  } : undefined;

  return (
    <div className={rootClass} ref={rootRef}>
      {hideLabel ? null : <span className="date-field-label">{label}</span>}
      <div className="date-field-row">
        <button
          ref={triggerRef}
          type="button"
          className={'date-field-btn' + (value ? '' : ' is-empty')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={`${label}：${display || placeholder}`}
          onClick={toggle}
        >
          <span className="date-field-text">{display || placeholder}</span>
          <Icon name={withTime ? 'clock' : 'calendar'} size={16} />
        </button>
      </div>
      {open && anchor && createPortal(
        <div
          id={dialogId}
          className="date-popover"
          style={popoverStyle}
          role="dialog"
          aria-modal="true"
          aria-label={`选择${label}`}
          ref={dialogRef}
          onKeyDown={onDialogKeyDown}
        >
          <DayPicker
            mode="single"
            selected={date || undefined}
            onSelect={selectDay}
            defaultMonth={date || undefined}
            locale={zhCN}
            weekStartsOn={1}
            fixedWeeks
            showOutsideDays
            autoFocus
          />
          <div className="date-popover-foot">
            <div className="date-presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="date-preset"
                  onClick={() => selectDay(p.date)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button type="button" className="date-preset is-clear" onClick={clear}>
              清除
            </button>
          </div>
          {withTime && (
            <div className="date-time-row">
              <span className="date-time-label">时刻</span>
              <input
                type="time"
                className="date-time-input"
                value={time || DEFAULT_TIME}
                disabled={!date}
                aria-label="提醒时刻"
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
