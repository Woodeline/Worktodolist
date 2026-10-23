// 编辑浮窗的渲染冒烟 + 一条结构约束。
//
// 为什么值得为它专门写测试：v1.1.0 在 Windows 上「点编辑 → 卡死且看不到界面」，
// 根因是这里的 Hooks 数量在两次渲染之间变了 —— 组件常驻挂载，第一次渲染（没在编辑）
// 调 3 个 Hook 就 return 了，第二次（正在编辑）多调了一个 useMemo。React 认定前后
// 不是同一个组件，直接抛错；树上没有错误边界，于是整棵 root 被卸载 —— 白屏、
// 点哪都没反应，跟卡死一模一样。
//
// 这类 bug 有两个特点：纯函数层的测试一条也拦不住（逻辑全对），而"打开浮窗点两下"
// 的人手验收又极容易在别的功能上分心。所以这里补两层网：
//   ① 渲染冒烟 —— 浮窗真的画得出来，字段真的带上了值；
//   ② 结构约束 —— 源码里提前 return 之后不许再出现 Hook（React 的硬规则）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import EditDrawer from './EditDrawer.jsx';
import { ContextMenuProvider } from '../hooks/useContextMenu.jsx';
import { parseSingleLine } from '../lib/todoParser.js';

function makeStore(task, override = {}) {
  return {
    editingTask: task,
    todoEntries: task ? [task] : [],
    doneEntries: [],
    noteIds: new Set(),
    getNote: () => '',
    saveNote: () => {},
    updateTask: () => {},
    deleteTask: () => {},
    addSubtask: () => {},
    toggleComplete: () => {},
    closeEditor: () => {},
    ...override,
  };
}

function render(store) {
  return renderToStaticMarkup(
    <ContextMenuProvider>
      <EditDrawer store={store} />
    </ContextMenuProvider>
  );
}

describe('EditDrawer 渲染', () => {
  it('没在编辑时什么都不画', () => {
    expect(render(makeStore(null))).toBe('');
  });

  it('正在编辑时画得出浮窗，字段带上了任务的值', () => {
    const task = parseSingleLine('(A) 交周报 @工作 +回测 due:2026-10-25 rec:mon id:aaa111');
    const markup = render(makeStore(task));
    expect(markup).toContain('交周报');
    expect(markup).toContain('edit-window');
    // 重复规则选中了预设里的「每周一」，而不是显示成空下拉
    expect(markup).toContain('value="mon"');
    expect(markup).toContain('@工作');
    expect(markup).toContain('+回测');
  });

  it('备注正文从 notes.md 读出来填进 textarea', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const markup = render(makeStore(task, { getNote: () => '记得附上上周的数据' }));
    expect(markup).toContain('记得附上上周的数据');
  });

  it('store 没有备注能力时也不崩（降级成空备注）', () => {
    const task = parseSingleLine('写周报 id:aaa111');
    const store = makeStore(task);
    delete store.getNote;
    expect(() => render(store)).not.toThrow();
  });
});

// ② 结构约束：Hooks 的数量必须在每次渲染里恒定。
//
// 直接读源码而不是靠渲染去撞 —— 服务端渲染每次都是全新实例，撞不出
// "Rendered more hooks than during the previous render."。这条规则只能静态守。
describe('EditDrawer 的 Hook 规则', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'EditDrawer.jsx'),
    'utf8'
  );
  const lines = src.split('\n');

  it('提前 return 之后不再调用任何 Hook', () => {
    const violations = [];
    let inGuard = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // 组件主体的提前 return（`  if (...) return null;` 这类）
      if (/^\s{2}if\s*\(.*\)\s*return\s+null;\s*$/.test(line)) inGuard = true;
      // 下一个顶层定义开始，说明上一个函数体已经结束
      if (/^(?:export\s+)?(?:default\s+)?(?:function|const|class)\s/.test(line) && i > 0) inGuard = false;
      if (!inGuard) continue;
      const code = line.split('//')[0];
      const m = code.match(/\buse[A-Z]\w*\s*\(/g);
      if (m) violations.push(`${i + 1}: ${m.join(', ')}`);
    }
    expect(violations).toEqual([]);
  });
});
