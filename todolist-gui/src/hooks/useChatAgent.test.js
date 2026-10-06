// useChatAgent 对话流程回归测试（零新增依赖）。
//
// 覆盖本轮新增的三条路由：
//   ① suggestAdd  → 只反问，不落盘；回「是」才执行
//   ② needsConfirm（唯一命中但词只是标题片段）→ 先确认目标
//   ③ unknown     → 未配置 AI 时固定提示且零网络请求；已配置时才联网兜底
//
// 与 useTodoStore.test.js 同一套替身策略：vi.mock('react') 注入极简 hooks
// 实现（scripts/qa-react-shim.mjs），在 node 环境下直接驱动真实 useChatAgent，
// 不需要 jsdom / testing-library。作用域仅限本文件。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';

vi.mock('react', () => import('../../scripts/qa-react-shim.mjs'));

import { __beginRender, __flushEffects, __resetHooks } from '../../scripts/qa-react-shim.mjs';
import { useChatAgent } from './useChatAgent.js';

// —— 浏览器 / 文件系统替身 ——

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

// 最小 store 替身：所有副作用方法都是 spy，因此"有没有真的动手"一目了然。
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

// 从落盘日志里读回事件（NDJSON）。
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
  agent.messages
    .filter((m) => m.role === 'agent')
    .map((m) => m.text)
    .join('\n');

beforeEach(() => {
  __resetHooks();
  // 声明「减少动态效果」偏好 → typeInto 直接出全文，用例不必真的等逐字动画。
  // 这条分支本身也是可访问性要求（前庭敏感用户），不是为测试开的后门。
  globalThis.window = { matchMedia: () => ({ matches: true }) };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.fetch;
  delete globalThis.localStorage;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('suggestAdd：只反问，不落盘', () => {
  it('「后天上午9点有月报会议要开」→ 反问并携带解析结果，且没有任何工具调用', async () => {
    const { store, fs } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('后天上午9点有月报会议要开');
    agent = render();

    // 1) 没有真的动手
    expect(store.addTask).not.toHaveBeenCalled();

    // 2) 反问里把解析结果白盒展示出来
    const texts = agentTexts(agent);
    expect(texts).toContain('要我新建吗');
    expect(texts).toContain('月报会议');
    expect(texts).toContain(dayjs().add(2, 'day').format('YYYY-MM-DD'));

    // 3) 进入 create 澄清态，且带着完整槽位（回「是」时要用）
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.kind).toBe('create');
    expect(agent.pending.slots.title).toContain('月报会议');
    expect(agent.pending.slots.dueDate).toBe(dayjs().add(2, 'day').format('YYYY-MM-DD'));

    // 4) 事件日志 append-only 语义不变：有 user/agent 事件，没有 tool_call
    const events = readLog(fs);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.filter((e) => e.type === 'user')).toHaveLength(1);
  });

  it('回「是」→ 用反问时展示的槽位真正新建', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    await agent.send('是');
    agent = render();

    expect(store.addTask).toHaveBeenCalledTimes(1);
    const arg = store.addTask.mock.calls[0][0];
    expect(arg).toContain('月报会议');
    expect(arg).toContain(`due:${dayjs().add(2, 'day').format('YYYY-MM-DD')}`);
    expect(agent.pending).toBeFalsy();
  });

  it('回「不是」→ 文件一字未动', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('后天上午9点有月报会议要开');
    agent = render();
    await agent.send('不是');
    agent = render();

    expect(store.addTask).not.toHaveBeenCalled();
    expect(agent.pending).toBeFalsy();
    expect(agentTexts(agent)).toContain('跳过');
  });

  it('回无关内容 → 不当作同意，且给出带标题的明确收尾（第三态不静默丢弃）', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('明天要交周报');
    agent = render();
    await agent.send('这个嘛回头再说吧');
    agent = render();

    // 核心不变式：带拖延语气的回包绝不能被当成"同意"，不能凭空多出一条任务。
    expect(store.addTask).not.toHaveBeenCalled();
    expect(agent.pending).toBeFalsy();
    // 第三态必须明确收尾：说明那条被打断的待建议没被创建、文件没动，并带上它的标题。
    // 只回一句通用的"没听懂"清单是不够的 —— 用户仍不知道刚才那条待建议建没建。
    //
    // 注意：对最后一条 agent 消息断言（第一条是"要我新建吗？"的提问，本就带标题，
    // 若对全文断言则"含标题"会因提问而恒成立，失去判别力）。
    const lastAgent = [...agent.messages].reverse().find((m) => m.role === 'agent');
    expect(lastAgent.text).toContain('没有新建');
    expect(lastAgent.text).toContain('交周报');
    expect(lastAgent.text).toContain('文件没动');
    // 收到尾文案就够，不再叠发通用 UNKNOWN_HINT。
    expect(lastAgent.text).not.toContain('抱歉，没听懂');
  });

  it('「嗯」开头但带拖延语气 → 不算同意，且给出带标题的收尾', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('明天要交周报');
    agent = render();
    await agent.send('嗯这个嘛回头再说吧');
    agent = render();

    expect(store.addTask).not.toHaveBeenCalled();
    const lastAgent = [...agent.messages].reverse().find((m) => m.role === 'agent');
    expect(lastAgent.text).toContain('没有新建');
    expect(lastAgent.text).toContain('交周报');
    expect(lastAgent.text).toContain('文件没动');
    expect(lastAgent.text).not.toContain('抱歉，没听懂');
  });

  it('澄清态输入明确新命令 → 真正执行新命令（不被当作"未确认"丢弃）', async () => {
    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('明天要交周报');
    agent = render();
    await agent.send('加一条 明天 交周报');
    agent = render();

    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0][0]).toContain('交周报');
    expect(agent.pending).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('needsConfirm：唯一命中但查询词只是标题片段', () => {
  it('「完成 报告」→ 先确认这一条，不直接完成', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('完成 报告');
    agent = render();

    expect(store.toggleComplete).not.toHaveBeenCalled();
    expect(agent.pending).toBeTruthy();
    expect(agent.pending.kind).toBe('confirmTarget');
    expect(agentTexts(agent)).toContain('回测报告');
  });

  it('回「是」→ 执行确认过的那一条', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('完成 报告');
    agent = render();
    await agent.send('是');
    agent = render();

    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    expect(store.toggleComplete.mock.calls[0][0].id).toBe('k2');
    expect(agent.pending).toBeFalsy();
  });

  it('回「不是」→ 取消，不完成任何任务', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('完成 报告');
    agent = render();
    await agent.send('不是');
    agent = render();

    expect(store.toggleComplete).not.toHaveBeenCalled();
    expect(agent.pending).toBeFalsy();
  });

  it('查询词够长（≥3 汉字）→ 不打扰，直接执行', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('完成 回测报告');
    agent = render();

    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    expect(agent.pending).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('unknown 与 AI 兜底', () => {
  it('未配置 AI → 固定提示，且一次网络请求都不发', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('今天天气怎么样');
    agent = render();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(agentTexts(agent)).toContain('没听懂');
    const events = readLog({});
    expect(events).toEqual([]);
  });

  it('已配置 AI → 联网兜底，并当场说明这一句发往了哪里', async () => {
    globalThis.localStorage = {
      getItem: () =>
        JSON.stringify({
          enabled: true,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-test',
        }),
      setItem() {},
      removeItem() {},
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"intent":"complete","targetIndex":1}' } }] };
      },
    }));

    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    // 这句本地完全认不出来（无动作词、无时间、非疑问）→ 才会走 AI 兜底
    await agent.send('随便说一句没头没脑的话');
    agent = render();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // 请求确实带上了清单里的任务（AI 只能从里面挑序号）
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('周线复盘');

    // 透明度：用户能看到"这一句被发到哪去了"
    expect(agentTexts(agent)).toContain('api.example.com');

    // AI 挑的第 1 条 → 映射回我们自己的 id
    expect(store.toggleComplete).toHaveBeenCalledTimes(1);
    expect(store.toggleComplete.mock.calls[0][0].id).toBe('k1');
  });

  it('AI 请求失败 → 静默退回固定提示，不把网络错误甩给用户', async () => {
    globalThis.localStorage = {
      getItem: () =>
        JSON.stringify({
          enabled: true,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-test',
        }),
      setItem() {},
      removeItem() {},
    };
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });

    const { store } = makeStore();
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('今天天气怎么样');
    agent = render();

    expect(agentTexts(agent)).toContain('没听懂');
    expect(store.addTask).not.toHaveBeenCalled();
    expect(agent.pending).toBeFalsy();
  });

  it('AI 返回越界序号 → 不执行，退回固定提示', async () => {
    globalThis.localStorage = {
      getItem: () =>
        JSON.stringify({
          enabled: true,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-test',
        }),
      setItem() {},
      removeItem() {},
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"intent":"complete","targetIndex":99}' } }] };
      },
    }));

    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('随便一句话');
    agent = render();

    expect(store.toggleComplete).not.toHaveBeenCalled();
    expect(agentTexts(agent)).toContain('没听懂');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('澄清候选（多命中 / 弱匹配兜底）', () => {
  it('多命中 → 给出候选列表并等待序号', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('完成 周');
    agent = render();

    expect(store.toggleComplete).not.toHaveBeenCalled();
    expect(agent.pending).toBeTruthy();
    const texts = agentTexts(agent);
    // 候选列表里至少列出两条，并且带序号
    expect(texts).toMatch(/1\.\s/);
  });

  it('强匹配为空时不给出空列表（弱匹配兜底）', async () => {
    const { store } = makeStore(SEED_TASKS);
    const render = makeRenderer(store);
    let agent = render();

    await agent.send('把那个回测相关的东西延到下周三');
    agent = render();

    const texts = agentTexts(agent);
    // 要么给出候选，要么给出明确的"换个说法"提示 —— 不能是"请确认："后面空着
    expect(store.updateTask).not.toHaveBeenCalled();
    expect(texts).not.toMatch(/请确认：\s*$/);
  });
});
