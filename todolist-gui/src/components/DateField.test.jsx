// 日期字段的渲染冒烟 + 结构约束。
//
// 项目没有 jsdom，交互（点开弹层、键盘、DayPicker 的 roving tabindex）测不了，
// 所以这里守两件静态渲染能守的事：界面读数用短日期、不把非 ISO 原文露给用户，
// 以及触发按钮的 dialog / aria 契约不能退化回原来的隐藏原生 input。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import DateField from './DateField.jsx';

const render = (props) => renderToStaticMarkup(<DateField {...props} />);
const base = { label: '截止日期', value: '2026-11-14', onChange: () => {} };

describe('DateField 渲染', () => {
  it('短日期读数 + 16px 图标，不带原生 picker', () => {
    const markup = render(base);
    expect(markup).toContain('2026/11/14');
    expect(markup).not.toContain('2026年');
    expect(markup).toContain('date-field-btn');
    expect(markup).not.toContain('date-field-native');
    expect(markup).not.toContain('showPicker');
  });

  it('触发按钮声明 dialog 语义，关闭态 aria-expanded=false', () => {
    const markup = render(base);
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="截止日期：2026/11/14"');
  });

  it('字段旁不再有 X 清除按钮；清除只留在日期弹层里', () => {
    const markup = render(base);
    expect(markup).not.toContain('date-clear-btn');
    expect(markup).not.toContain('aria-label="清除截止日期"');
    const empty = render({ ...base, value: '' });
    expect(empty).toContain('未设置');
  });

  it('rem 形状补上 HH:mm，非法值不露原文', () => {
    expect(render({ ...base, value: '2026-11-14T15:30', withTime: true }))
      .toContain('2026/11/14 15:30');
    expect(render({ ...base, value: '25:99' })).not.toContain('25:99');
  });

  it('hideLabel 时不画第二层标签，但仍有可读名字', () => {
    const markup = render({ ...base, hideLabel: true });
    expect(markup).not.toContain('date-field-label');
    expect(markup).toContain('aria-label="截止日期：2026/11/14"');
  });
});

describe('DateField 结构约束', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'DateField.jsx'),
    'utf8'
  );

  it('弹层用真 DOM 并接上中文 locale 与周一起始', () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('locale={zhCN}');
    expect(src).toContain('weekStartsOn={1}');
    expect(src).toContain('fixedWeeks');
    expect(src).toContain('showOutsideDays');
  });

  it('Escape 抢在编辑浮窗之前，且归还焦点', () => {
    expect(src).toContain("document.addEventListener('keydown', onKeyDown, true)");
    expect(src).toContain('triggerRef.current?.focus()');
  });

  it('值形状仍由 lib/dateField.js 统一产出', () => {
    expect(src).toContain('formatDateValue(nextDate, nextTime, withTime)');
    expect(src).not.toContain('type="datetime-local"');
    expect(src).not.toContain('type="date"');
  });

  it('清除入口只留弹层里那一颗，字段旁不画第二颗', () => {
    expect(src).not.toContain('date-clear-btn');
    expect(src).toContain('className="date-preset is-clear"');
    expect(src).toContain('onClick={clear}');
  });
});
