// eventLog 测试：append-only 落盘、读取、重放（纯函数、无副作用）。
import { describe, expect, it } from 'vitest';
import { appendEvent, loadEvents, makeEvent, replay, sessionFileName } from './eventLog.js';

// 内存目录句柄替身（仅实现 eventLog 用到的方法）。
function makeDirHandle() {
  const map = {};
  return {
    _files: map,
    async getFileHandle(name, opt) {
      if (!(name in map)) {
        if (opt && opt.create) map[name] = '';
        else {
          const e = new Error('NotFound');
          e.name = 'NotFoundError';
          throw e;
        }
      }
      return {
        async getFile() {
          return {
            async text() {
              return map[name];
            },
          };
        },
        async createWritable() {
          return {
            async write(t) {
              map[name] = t;
            },
            async close() {},
          };
        },
      };
    },
  };
}

const TS = '2026-10-01T09:00:00.000Z';

describe('append-only 落盘与读取', () => {
  it('按顺序追加，文件名按日期', async () => {
    const dir = makeDirHandle();
    const e1 = makeEvent(1, 'user', { text: '有哪些任务' }, TS);
    const e2 = makeEvent(2, 'agent', { text: '共 0 条' }, TS);
    await appendEvent(dir, e1);
    await appendEvent(dir, e2);

    const raw = dir._files[sessionFileName('2026-10-01')];
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(raw.split('\n')[0])).toEqual(e1);

    const events = await loadEvents(dir, '2026-10-01');
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('append-only：先写入的行永不改变', async () => {
    const dir = makeDirHandle();
    await appendEvent(dir, makeEvent(1, 'user', { text: 'a' }, TS));
    const before = dir._files[sessionFileName('2026-10-01')];
    await appendEvent(dir, makeEvent(2, 'user', { text: 'b' }, TS));
    const after = dir._files[sessionFileName('2026-10-01')];
    expect(after.startsWith(before)).toBe(true);
  });

  it('损坏行被跳过', async () => {
    const dir = makeDirHandle();
    await appendEvent(dir, makeEvent(1, 'user', { text: 'a' }, TS));
    dir._files[sessionFileName('2026-10-01')] += '{ 坏行 \n';
    await appendEvent(dir, makeEvent(2, 'user', { text: 'b' }, TS));
    const events = await loadEvents(dir, '2026-10-01');
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('无句柄时不抛异常', async () => {
    await expect(appendEvent(null, makeEvent(1, 'user', {}, TS))).resolves.toBe(false);
    await expect(loadEvents(null, '2026-10-01')).resolves.toEqual([]);
  });
});

describe('replay 重放（无副作用）', () => {
  it('user / tool_call / tool_result / agent 还原为聊天记录', () => {
    const events = [
      makeEvent(1, 'user', { text: '完成 回测报告' }, TS),
      makeEvent(2, 'intent', { intent: 'complete' }, TS),
      makeEvent(3, 'tool_call', { callId: 'call-1', tool: { name: 'todo.complete', params: { target: '回测报告' } } }, TS),
      makeEvent(4, 'tool_result', { callId: 'call-1', status: 'ok', durationMs: 3, params: { target: '回测报告', title: '写第 10 周回测报告' } }, TS),
      makeEvent(5, 'agent', { text: '已完成：写第 10 周回测报告' }, TS),
    ];
    const msgs = replay(events);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'tool', 'agent']);
    expect(msgs[1].tool.status).toBe('ok');
    expect(msgs[1].tool.durationMs).toBe(3);
    expect(msgs[1].tool.params.title).toBe('写第 10 周回测报告');
    expect(msgs[2].text).toContain('已完成');
  });

  it('tool_call 无结果时保持 running', () => {
    const events = [makeEvent(1, 'tool_call', { callId: 'c', tool: { name: 'todo.query' } }, TS)];
    const msgs = replay(events);
    expect(msgs[0].tool.status).toBe('running');
    expect(msgs[0].tool.durationMs).toBe(null);
  });

  it('error 事件渲染为错误消息', () => {
    const msgs = replay([makeEvent(1, 'error', { message: 'boom' }, TS)]);
    expect(msgs[0].role).toBe('agent');
    expect(msgs[0].kind).toBe('error');
    expect(msgs[0].text).toBe('boom');
  });

  it('重放不产生任何副作用（对同一事件流多次调用结果一致）', () => {
    const events = [
      makeEvent(1, 'user', { text: 'a' }, TS),
      makeEvent(2, 'agent', { text: 'b' }, TS),
    ];
    expect(replay(events)).toEqual(replay(events));
  });
});
