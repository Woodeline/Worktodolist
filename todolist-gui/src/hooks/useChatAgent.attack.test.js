// QA 对抗性时序用例（严过关独立编写）—— 本轮修复 A（create 澄清态第三态重入）专项。
//
// 与 useChatAgent.test.js 同一套替身策略：vi.mock('react') 注入 scripts/qa-react-shim.mjs
// 的极简 hooks，在 node 环境下直接驱动真实 useChatAgent，无需 jsdom / testing-library。
//
// ⚠ 替身返回的是"渲染时刻的快照"：每次要读新状态必须重新 render()。
// 本文件刻意只覆盖工程师用例之外的对抗性时序：重入顺序、事件日志、空输入、嵌套澄清。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useChatAgent } from './useChatAgent.js';

// —— 浏览器 / 文件系统替身（与既有用例同构） ——
function makeDir(map) {
  const handleFor = (name) => ({
    async getFile() {
      return { async text() { return map[name] ?? ''; } };
    },
    async createWritable() {
      return { async write(t) { map[name] = t; }, async close() {} };
    },
  });
  return {
    async getFileHandle(name, opt) {
      if (!(name in map)) {
        if (opt && opt.create) map[name] = '';
        else {
          const e = new Error('NotFound');
          e.name = 'NotFoundError';
          throw e;
        }
      }
      return handleFor(name);
    },
  };
}

function makeStore(entries = []) {
  const fs = {};
  const store = {
    todoEntries: entries,
    doneEntries: [],
    sortMode: 'auto',
    dirReady: true,
    dirHandleRef: { current: makeDir(fs) },
    addTask: vi.fn((text) => ({ kind: 'task', id: 'new1', title: text, completed: false })),
    updateTask: vi.fn(),
    toggleComplete: vi.fn(),
    deleteTask: vi.fn(),
    undo: vi.fn(),
  };
  return { store, fs };
}

function readLog(fs) {
  const key = Object.keys(fs).find((k) => k.startsWith('session-') && k.endsWith('.ndjson'));
  if (!key) return [];
  return String(fs[key])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function makeRenderer(store) {
  return () => {
    __beginRender();
    const api = useChatAgent(store);
    __flushEffects();
    return api;
  };
}

const SEED_TASKS = [
  { kind: 'task', id: 'k1', title: '带截止日的周线复盘', completed: false, contexts: [], projects: [] },
  { kind: 'task', id: 'k2', title: '今天到期：写第 10 周回测报告', completed: false, contexts: [], projects: [] },
];

const agentTexts = (agent) =>
  agent.messages.filter((m) => m.role === 'agent').map((m) => m.text).join('\n');
const lastAgent = (agent) => [...agent.messages].reverse().find((m) => m.role === 'agent');
const userEvents = (fs) => readLog(fs).filter((e) => e.type === 'user');

beforeEach(() => {
  __resetHooks();
  globalThis.window = { matchMedia: () => ({ matches: true }) };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.fetch;
  delete globalThis.localStorage;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('对抗性 #1-4：create 澄清态三态的严格边界', () => {
  it('#1 create 态 →「是」：addTask 恰好 1 次，pending 清空', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    expect(agent.pending && agent.pending.kind).toBe('create');

    await agent.send('是');
    agent = render();

    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(agent.pending).toBeFalsy();
  });

  it('#2 create 态 →「加一条 明天 交周报」：真正新建，且不出现任何"没确认"收尾', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();

    await agent.send('加一条 明天 交周报');
    agent = render();

    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0][0]).toContain('交周报');
    // 明确新命令 → 不能被当作"未确认"丢弃，也不该叠发收尾文案
    expect(agentTexts(agent)).not.toContain('没有新建');
    expect(agentTexts(agent)).not.toContain('没有确认');
    expect(agent.pending).toBeFalsy();
  });

  it('#3 create 态 →「不是」：addTask 0 次，回「好的，已跳过，文件没动。」', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();

    await agent.send('不是');
    agent = render();

    expect(store.addTask).not.toHaveBeenCalled();
    expect(agent.pending).toBeFalsy();
    expect(lastAgent(agent).text).toContain('好的，已跳过，文件没动。');
  });

  it('#4 create 态 →「嗯这个嘛回头再说吧」：最后一条 agent 消息带标题收尾，且不含通用"没听懂"', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();

    await agent.send('嗯这个嘛回头再说吧');
    agent = render();

    expect(store.addTask).not.toHaveBeenCalled();
    const last = lastAgent(agent).text;
    expect(last).toContain('没有新建');
    expect(last).toContain('月报会议');
    expect(last).toContain('文件没动');
    expect(last).not.toContain('抱歉，没听懂');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('对抗性 #5-6：create 态改口说新命令（含最高风险的 suggestAdd 重入）', () => {
  it('#5 create 态 →「完成 报告」：进入新的 confirmTarget 澄清，旧 create 不复活，随后回「是」完成正确那条', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('明天要交周报');
    agent = render();
    expect(agent.pending.kind).toBe('create');

    await agent.send('完成 报告');
    agent = render();

    // 新澄清语义正确、旧 create 未复活
    expect(store.toggleComplete).not.toHaveBeenCalled();
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.kind).toBe('confirmTarget');
    expect(agent.pending.keyword).toBeUndefined(); // confirmTarget 不带 keyword

    await agent.send('是');
    agent = render();

    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    // 必须完成"报告"对应的那条（id=k2），而不是别的
    expect(store.toggleComplete.mock.calls[0][0].id).toBe('k2');
    expect(agent.pending).toBeFalsy();
  });

  it('#6 create 态 →「明天要交周报」：新 suggestAdd 请求里出现新标题，pending.keyword 被替换（最高风险路径）', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    expect(agent.pending.keyword).toContain('月报会议');

    await agent.send('明天要交周报');
    agent = render();

    // setPending(null) 与 route 内 askCreate 的新 pending 的先后顺序：
    // 必须以新的 pending 为准，旧的「月报会议」不得残留。
    expect(store.addTask).not.toHaveBeenCalled();
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.kind).toBe('create');
    expect(agent.pending.keyword).toBe('交周报');
    expect(lastAgent(agent).text).toContain('交周报');
    expect(lastAgent(agent).text).not.toContain('月报会议');

    // 再回「是」应只新建新的那条
    await agent.send('是');
    agent = render();
    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0][0]).toContain('交周报');
    expect(store.addTask.mock.calls[0][0]).not.toContain('月报会议');
  });

  it('#7 create 态连续三轮重入：pending 语义每轮正确，无状态泄漏，最后一条命令被正确执行', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('后天有月报会议要开'); // 第 0 轮 create
    agent = render();
    expect(agent.pending.keyword).toContain('月报会议');

    const rounds = ['明天要交周报', '下周要体检', '月底要复盘'];
    const expectKw = ['交周报', '体检', '复盘'];
    for (let i = 0; i < rounds.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await agent.send(rounds[i]);
      agent = render();
      expect(agent.pending).toBeTruthy();
      expect(agent.pending.kind).toBe('create');
      expect(agent.pending.keyword).toBe(expectKw[i]);
      expect(store.addTask).not.toHaveBeenCalled(); // 全程只建议、不落盘
    }

    await agent.send('是');
    agent = render();
    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0][0]).toContain('复盘'); // 最后一轮的标题
    expect(agent.pending).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('对抗性 #8-10：空输入 / 事件日志 / confirmTarget 收尾', () => {
  it('#8 pending 态发送空串或纯空白：send() 早退，pending 必须仍然活着', async () => {
    const { store, fs } = makeStore();
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    const before = { kind: agent.pending.kind, keyword: agent.pending.keyword };
    const userBefore = userEvents(fs).length;

    await agent.send('');
    agent = render();
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.kind).toBe(before.kind);
    expect(agent.pending.keyword).toBe(before.keyword);

    await agent.send('    ');
    agent = render();
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.keyword).toBe(before.keyword);

    // 空输入不得落任何 user 事件
    expect(userEvents(fs).length).toBe(userBefore);

    // pending 仍可被「是」正常消费
    await agent.send('是');
    agent = render();
    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(agent.pending).toBeFalsy();
  });

  it('#9 事件日志不变式：一次 send() 只落 1 条 user 事件（澄清重入不重复写 user）', async () => {
    const { store, fs } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('后天上午9点有月报会议要开'); // 1 条 user
    agent = render();
    expect(userEvents(fs)).toHaveLength(1);

    await agent.send('加一条 明天 交周报'); // 触发 create 重入 → 仍应只 1 条 user
    agent = render();

    const users = userEvents(fs);
    expect(users).toHaveLength(2);
    // 事件负载里 user 文本位于 payload.text（见 lib/eventLog.js makeEvent）
    expect(users.filter((e) => e.payload.text === '加一条 明天 交周报')).toHaveLength(1);
    expect(users.filter((e) => e.payload.text === '后天上午9点有月报会议要开')).toHaveLength(1);
    // 重入写出的意图/工具事件可以有，但 user 事件绝不能翻倍
    expect(store.addTask).toHaveBeenCalledTimes(1);
  });

  it('#10 confirmTarget 态 →「嗯这个嘛回头再说吧」：必须明确收尾，不能静默', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('完成 报告');
    agent = render();
    expect(agent.pending.kind).toBe('confirmTarget');

    await agent.send('嗯这个嘛回头再说吧');
    agent = render();

    expect(store.toggleComplete).not.toHaveBeenCalled();
    const last = lastAgent(agent);
    expect(last).toBeTruthy();
    expect(last.text).toContain('已取消本次操作');
    expect(agent.pending).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 对抗性补充：create 第三态 × AI 兜底 的【联合路径】。
//
// route() 在 unknown 分支里先走 tryFallback：
//   AI 成功 → 返回 'done' → 调用方【不得】出收尾；
//   AI 失败(null) → 返回 'unknown' → 调用方【必须】出带标题收尾。
// "AI 成功时不许出收尾" 是个非平凡不变式（极易写成无论 AI 成不成都出收尾），
// 这两条此前只有静态论证、没有独立用例，故补上。
describe('对抗性补充 #11-12：create 第三态 × AI 兜底联合路径', () => {
  const AI_CFG = {
    enabled: true,
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
  };
  // 装上"已配置 AI"的 localStorage + 指定 fetch 替身（afterEach 统一清理这两个全局）
  const installAi = (fetchImpl) => {
    globalThis.localStorage = {
      getItem: () => JSON.stringify(AI_CFG),
      setItem() {},
      removeItem() {},
    };
    globalThis.fetch = fetchImpl;
  };

  it('#11 create 态 + 已配置 AI + AI 成功 → 按 AI 意图执行，且【不出收尾】', async () => {
    installAi(
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: '{"intent":"complete","targetIndex":1}' } }] };
        },
      }))
    );

    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开'); // 进入 create 澄清
    agent = render();
    expect(agent.pending.kind).toBe('create');

    await agent.send('嗯这个嘛回头再说吧'); // 第三态；本地 unknown → AI 兜底成功
    agent = render();

    // ① 确实走了 AI 并按 AI 的意图执行（complete 第 1 条 = k1）
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    expect(store.toggleComplete.mock.calls[0][0].id).toBe('k1');
    // ② AI 成功 → 绝不能出"没有新建"收尾（最容易写错的不变式）
    expect(agentTexts(agent)).not.toContain('没有新建');
    // ③ 旧 create 的 pending 不得复活；且没有凭空新建任务
    expect(agent.pending).toBeFalsy();
    expect(store.addTask).not.toHaveBeenCalled();
  });

  it('#12 create 态 + 已配置 AI + AI 请求失败 → 静默退回，【必须出带标题收尾】', async () => {
    installAi(
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();
    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    expect(agent.pending.kind).toBe('create');

    await agent.send('嗯这个嘛回头再说吧'); // 第三态；AI 抛错 → tryFallback 返回 null → 'unknown'
    agent = render();

    // AI 失败不把网络错误甩给用户；回到未知态 → 必须出收尾（带被打断的标题 + 文件没动）
    expect(store.addTask).not.toHaveBeenCalled();
    expect(store.toggleComplete).not.toHaveBeenCalled();
    const last = lastAgent(agent).text;
    expect(last).toContain('没有新建');
    expect(last).toContain('月报会议');
    expect(last).toContain('文件没动');
    expect(last).not.toContain('抱歉，没听懂');
  });
});
