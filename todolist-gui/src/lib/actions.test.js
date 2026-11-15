// dispatch 覆盖测试：只跑「工具提议 → 确认落盘」这条路径。
//
// 对话功能剥离后，dispatch 的唯一生产调用方是 ToolsPage.confirmProposal()
// （proposalToIntent → dispatch）。所以这里直接喂提议产出的意图，不再经过
// 中文解析层 —— 断言的是「工具的批量改动真的只经 store 方法」。
import { describe, expect, it, vi } from 'vitest';
import { dispatch } from './actions.js';
import { proposalToIntent, makeBatchProposal } from './proposals.js';
import { parseFile } from './todoParser.js';

const TODAY = '2026-10-01';

// 用真实解析器造任务：contexts / projects / extraTags / id 都是产线形状，
// 免得手工夹具与 serializeTask 的必需字段漂移。
const TASKS = parseFile(
  [
    '(A) 2026-09-20 季报复核 due:2026-09-25',
    '(B) 2026-09-20 写周报 due:2026-10-10',
    '(C) 2026-09-20 画图',
  ].join('\n')
).filter((e) => e.kind === 'task');

const [T1, T2, T3] = TASKS;

function makeStore() {
  return {
    addTask: vi.fn((raw) => ({ id: 'new1', title: String(raw) })),
    updateTask: vi.fn(),
    toggleComplete: vi.fn(),
    deleteTask: vi.fn(),
    undo: vi.fn(),
    doneEntries: [],
  };
}

const ctx = (store, tasks = TASKS) => ({ store, tasks, today: TODAY });

describe('dispatch · 工具提议路径', () => {
  it('create 提议 → 走 store.addTask，标题与截止日来自字段', () => {
    const store = makeStore();
    const intent = proposalToIntent({
      kind: 'create',
      items: [{ fields: { title: '交周报', dueDate: '2026-10-02' } }],
    });
    const r = dispatch(intent, ctx(store));
    expect(r.ok).toBe(true);
    expect(r.tool.name).toBe('todo.add');
    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0][0]).toContain('交周报');
    expect(store.addTask.mock.calls[0][0]).toContain('due:2026-10-02');
    // 不写默认优先级：只有显式给了才带 (X)
    expect(store.addTask.mock.calls[0][0]).not.toMatch(/^\(/);
  });

  it('create 提议带优先级 → 行首写 (A)', () => {
    const store = makeStore();
    const intent = proposalToIntent({
      kind: 'create',
      items: [{ fields: { title: '交周报', priority: 'A' } }],
    });
    dispatch(intent, ctx(store));
    expect(store.addTask.mock.calls[0][0]).toMatch(/^\(A\)/);
  });

  it('edit 提议 → 逐条 updateTask，缺 id 的那条静默跳过', () => {
    const store = makeStore();
    const r = dispatch(
      {
        intent: 'edit',
        target: null,
        slots: {
          items: [
            { id: T1.id, patch: { priority: 'A' } },
            { id: 'gone', patch: { priority: 'A' } },
          ],
        },
        matches: [T1.id, 'gone'],
      },
      ctx(store)
    );
    expect(r.ok).toBe(true);
    expect(store.updateTask).toHaveBeenCalledTimes(1);
    expect(store.updateTask).toHaveBeenCalledWith(T1.id, { priority: 'A' });
  });

  it('edit 提议全部落空 → 不假报成功', () => {
    const store = makeStore();
    const r = dispatch(
      { intent: 'edit', slots: { items: [{ id: 'gone', patch: { priority: 'A' } }] }, matches: ['gone'] },
      ctx(store)
    );
    expect(r.ok).toBe(false);
    expect(store.updateTask).not.toHaveBeenCalled();
  });

  it('batch 提议（优先级）→ 逐条 updateTask，工具名 todo.batch', () => {
    const store = makeStore();
    const p = makeBatchProposal(TASKS, { type: 'setPriority', value: 'A' }, TODAY);
    const intent = proposalToIntent(p);
    expect(intent.intent).toBe('batch');
    const r = dispatch(intent, ctx(store));
    expect(r.ok).toBe(true);
    expect(r.tool.name).toBe('todo.batch');
    expect(store.updateTask).toHaveBeenCalledTimes(3);
    expect(store.updateTask.mock.calls[0]).toEqual([T1.id, { priority: 'A' }]);
  });

  it('batch 提议（完成）→ 走 toggleComplete，不直接改文件', () => {
    const store = makeStore();
    const intent = { intent: 'batch', slots: { op: { type: 'complete' } }, matches: [T2.id] };
    const r = dispatch(intent, ctx(store));
    expect(r.ok).toBe(true);
    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    expect(store.toggleComplete.mock.calls[0][0].id).toBe(T2.id);
  });

  it('batch 全部处于目标状态 → ok:false 且不产生空改动', () => {
    const store = makeStore();
    // T3 本来没有 star，取消星标属于无变化
    const intent = { intent: 'batch', slots: { op: { type: 'unstar' } }, matches: [T3.id] };
    const r = dispatch(intent, ctx(store));
    expect(r.ok).toBe(false);
    expect(store.updateTask).not.toHaveBeenCalled();
    expect(store.deleteTask).not.toHaveBeenCalled();
  });

  it('未知意图 → 拒绝执行，且不碰 store', () => {
    const store = makeStore();
    const r = dispatch({ intent: 'nope' }, ctx(store));
    expect(r.ok).toBe(false);
    expect(r.tool.name).toBe('agent.noop');
    expect(store.addTask).not.toHaveBeenCalled();
    expect(store.updateTask).not.toHaveBeenCalled();
  });

  it('undo → 复用 store.undo', () => {
    const store = makeStore();
    const r = dispatch({ intent: 'undo' }, ctx(store));
    expect(r.ok).toBe(true);
    expect(r.tool.name).toBe('todo.undo');
    expect(store.undo).toHaveBeenCalledTimes(1);
  });
});
