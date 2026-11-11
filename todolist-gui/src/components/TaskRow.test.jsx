// 子任务展示的渲染冒烟。
//
// 逻辑层（subtasks.js）已经有完整断言，这里只补最后一公里：
// 「层级真的变成了缩进类」「进度真的显示成了 1/3」「重复标记真的渲染出来」。
// 这几处失效同样是静默的 —— prop 传漏了界面不会报错，只是退回成看不出关系的一排行。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskRow, { Highlight } from './TaskRow.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';

function render(task, props, storeOverride) {
  const store = {
    noteIds: new Set(),
    fadingIds: [],
    spawnedIds: [],
    enteringIds: [],
    dropInfo: null,
    sortMode: 'manual',
    view: 'all',
    focusedId: null,
    dragId: null,
    setFocusedId: () => {},
    openEditor: () => {},
    toggleComplete: () => {},
    updateTask: () => {},
    deleteTask: () => {},
    setDragId: () => {},
    setDropInfo: () => {},
    reorder: () => {},
    ...storeOverride,
  };
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <TaskRow task={task} store={store} {...props} />
    </ContextMenuProvider>
  );
}

describe('TaskRow 子任务展示', () => {
  it('子任务行带缩进类 is-child', () => {
    const kid = parseSingleLine('拆后盖 parent:p00002');
    expect(render(kid, { depth: 1 })).toContain('is-child');
  });

  it('顶层行不带缩进类', () => {
    const parent = parseSingleLine('装机 id:p00002');
    expect(render(parent, { depth: 0 })).not.toContain('is-child');
  });

  it('父任务显示进度 1/3', () => {
    const parent = parseSingleLine('装机 id:p00002');
    expect(render(parent, { kids: { done: 1, total: 3 } })).toContain('1/3');
  });

  it('没有子任务时不显示进度', () => {
    const parent = parseSingleLine('装机 id:p00002');
    const markup = render(parent, { kids: { done: 0, total: 0 } });
    expect(markup).not.toContain('sub-count');
  });
});

describe('TaskRow 重复标记', () => {
  it('带 rec: 的任务显示 ↻，且规则写进 title', () => {
    const t = parseSingleLine('交周报 rec:mon,thu');
    const markup = render(t);
    expect(markup).toContain('rec-chip');
    // 完整规则只放在悬停提示里：列表是用来扫的，不该挤掉日期的位置
    expect(markup).toContain('重复：每周一、四');
  });

  it('不带 rec: 的任务没有重复标记', () => {
    expect(render(parseSingleLine('交周报'))).not.toContain('rec-chip');
  });

  it('认不出的 rec: 也不显示标记（它已经降级成普通标签）', () => {
    expect(render(parseSingleLine('交周报 rec:每周一'))).not.toContain('rec-chip');
  });
});

describe('TaskRow 备注标记', () => {
  it('有备注的任务显示 ✎', () => {
    const markup = render(parseSingleLine('写周报 id:aaa111'), {}, { noteIds: new Set(['aaa111']) });
    expect(markup).toContain('note-chip');
  });

  it('没备注的任务不显示', () => {
    expect(render(parseSingleLine('写周报 id:aaa111'))).not.toContain('note-chip');
  });

  it('没有 id 的任务永远不长角标 —— 没有 id 就挂不住备注', () => {
    const markup = render(parseSingleLine('写周报'), {}, { noteIds: new Set(['aaa111']) });
    expect(markup).not.toContain('note-chip');
  });
});

// 动效类名：CSS 只认类名，store 只发类名 —— 这一层断在哪边界面都看不出来，
// 所以每条动效状态都在这里钉一个渲染断言。
describe('TaskRow 动效类名', () => {
  it('退场窗口内的行带 completing，复选框按已勾上预览', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t, {}, { fadingIds: [t.id] });
    expect(markup).toContain('completing');
    // 数据还没提交，但勾选框要先「演」出结果，否则点了 180ms 内没有任何反馈
    expect(markup).toContain('checkbox checked');
  });

  it('已完成行（done.txt）不带 completing —— 不给静态列表挂常驻动画', () => {
    const t = parseSingleLine('x 2026-10-01 交周报');
    expect(t.completed).toBe(true);
    const markup = render(t, {}, { fadingIds: [t.id] });
    expect(markup).not.toContain('completing');
  });

  it('重复任务的新生行带 spawned（交接高亮）', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { spawnedIds: [t.id] })).toContain('spawned');
  });

  it('刚添加的行带 entering（入场高亮）', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { enteringIds: [t.id] })).toContain('entering');
  });

  it('行上带 data-task-id —— 浮窗关闭后焦点靠它找回原行', () => {
    const t = parseSingleLine('交周报');
    expect(render(t)).toContain(`data-task-id="${t.id}"`);
  });
});

describe('TaskRow 拖拽落点与快捷按钮', () => {
  it('落点在本行前缘时带 drop-before', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { dropInfo: { id: t.id, after: false } })).toContain('drop-before');
  });

  it('落点在本行后缘时带 drop-after', () => {
    const t = parseSingleLine('交周报');
    expect(render(t, {}, { dropInfo: { id: t.id, after: true } })).toContain('drop-after');
  });

  it('落点在别的行上时，本行不画线', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t, {}, { dropInfo: { id: 'other-id', after: true } });
    expect(markup).not.toContain('drop-after');
    expect(markup).not.toContain('drop-before');
  });

  it('可编辑行带三个快捷按钮（星标 / 今天 / 删除）', () => {
    const t = parseSingleLine('交周报');
    const markup = render(t);
    expect(markup).toContain('row-quick');
    expect(markup.match(/row-quick-btn/g)).toHaveLength(3);
  });

  it('只读行（done.txt）没有快捷按钮', () => {
    const t = parseSingleLine('x 2026-10-01 交周报');
    expect(render(t, { readonly: true })).not.toContain('row-quick');
  });

  it('dragDisabled 关掉行级拖拽 —— 日历日详情借这行展示，改期由日历自己接管', () => {
    const t = parseSingleLine('交周报');
    expect(render(t)).toContain('draggable="true"');
    expect(render(t, { dragDisabled: true })).toContain('draggable="false"');
  });
});

describe('TaskRow 优先级的界面口径', () => {
  // 界面读数要一眼看出急慢；(A)/(B)/(C) 只是 todo.txt 里的写法，
  // 只留在 title 与编辑抽屉的「写入行」里。这条契约防止两种静默回退：
  // 改回纯字母（看不懂）或改回彩色药丸（把真正逾期的那条淹掉）。
  it('三档显示中文分级，原文记号保留在悬停里', () => {
    const high = render(parseSingleLine('(A) 交周报'));
    expect(high).toContain('>高</span>');
    expect(high).toContain('todo.txt 写作 (A)');
    expect(render(parseSingleLine('(B) 写周报'))).toContain('>中</span>');
    expect(render(parseSingleLine('(C) 买网线'))).toContain('>低</span>');
  });

  it('任务行不把文件记号当显示文本', () => {
    const markup = render(parseSingleLine('(A) 交周报'));
    expect(markup).not.toContain('>(A)</span>');
    expect(markup).not.toContain('>(B)</span>');
  });

  it('没填优先级时留空槽，不画成「中」', () => {
    const markup = render(parseSingleLine('交周报'));
    expect(markup).toContain('prio-badge prio-none');
    expect(markup).not.toContain('>中</span>');
  });

  it('元信息簇里没有裸文本：JSX 里的注释必须写成 {/* */}', () => {
    // 真事：把 `// 注释` 写在 JSX 子元素位置，React 会当成文本节点画进任务行。
    // 页面不报错，只是行里凭空多两行中文、把布局撑到触屏命中区失效。
    const markup = render(parseSingleLine('(A) 交周报'));
    expect(markup).not.toContain('字阶徽章');
    expect(markup).not.toContain('//');
    expect(markup.match(/class="task-meta"[^>]*>([^<]*)</)?.[1]).toBe('');
  });

  it('四档各有独立档位类：高／中／低／无没有谁被并进默认态', () => {
    expect(render(parseSingleLine('(A) 甲'))).toContain('prio-badge prio-high');
    expect(render(parseSingleLine('(B) 乙'))).toContain('prio-badge prio-mid');
    expect(render(parseSingleLine('(C) 丙'))).toContain('prio-badge prio-low');
    expect(render(parseSingleLine('丁'))).toContain('prio-badge prio-none');
    // D~Z 允许写进 todo.txt，界面得有第五档兜底，不能假装它不存在
    expect(render(parseSingleLine('(D) 戊'))).toContain('prio-badge prio-other');
  });
});

describe('Highlight 搜索高亮', () => {
  it('没有搜索词时原样返回', () => {
    const markup = renderToStaticMarkup(<Highlight text="交周报" query="" />);
    expect(markup).toBe('交周报');
  });

  it('多处匹配全部高亮，不是只标第一个', () => {
    const markup = renderToStaticMarkup(<Highlight text="周报周报周报" query="周报" />);
    expect(markup.match(/<mark>/g)).toHaveLength(3);
  });

  it('大小写不敏感', () => {
    const markup = renderToStaticMarkup(<Highlight text="Weekly 周报" query="weekly" />);
    expect(markup).toContain('<mark>Weekly</mark>');
  });

  it('没命中时不高亮', () => {
    const markup = renderToStaticMarkup(<Highlight text="交周报" query="装机" />);
    expect(markup).not.toContain('<mark>');
  });
});
