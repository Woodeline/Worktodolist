// aiFallback 测试（零新增依赖，node 环境）。
//
// 重点验证两条硬约束：
//  ① 没配置 = 绝不发网络请求（离线可用性）
//  ② AI 只能从我们给的任务清单里挑序号，不能自己造 id
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_LIMITS,
  DEFAULT_AI_CONFIG,
  aiHost,
  callAiFallback,
  clearAiConfig,
  isAiConfigured,
  loadAiConfig,
  normalizeAiConfig,
  normalizeAiIntent,
  saveAiConfig,
  subscribeAiConfig,
  testAiConnection,
} from './aiFallback.js';

const TASKS = [
  { id: 't1', title: '带截止日的周线复盘', priority: 'B', dueDate: '2026-10-04' },
  { id: 't2', title: '今天到期：写第 10 周回测报告', priority: 'B', dueDate: '2026-09-30' },
  { id: 't3', title: '收集箱任务：无任何标记的裸任务' },
];

// 极简 localStorage 替身（node 环境没有）
function installLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  return map;
}

beforeEach(() => {
  installLocalStorage();
});
afterEach(() => {
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

describe('配置读写', () => {
  it('未配置时 loadAiConfig 返回 null，isAiConfigured 为 false', () => {
    expect(loadAiConfig()).toBeNull();
    expect(isAiConfigured(null)).toBe(false);
    expect(isAiConfigured()).toBe(false);
  });

  it('saveAiConfig → loadAiConfig 往返一致（缺失字段补默认值）', () => {
    saveAiConfig({ enabled: true, apiKey: 'sk-test' });
    const cfg = loadAiConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(cfg.model).toBe(DEFAULT_AI_CONFIG.model);
  });

  it('clearAiConfig 后回到未配置', () => {
    saveAiConfig({ enabled: true, apiKey: 'sk-test' });
    clearAiConfig();
    expect(loadAiConfig()).toBeNull();
  });

  it('localStorage 抛异常时不崩（隐私模式 / 禁用存储）', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(loadAiConfig()).toBeNull();
    expect(saveAiConfig({ enabled: true })).toBe(false);
    expect(clearAiConfig()).toBe(false);
  });

  it('存储内容损坏（非 JSON）时返回 null', () => {
    localStorage.setItem('todogui.aiFallback', '{oops');
    expect(loadAiConfig()).toBeNull();
  });

  it('isAiConfigured：三项齐全才算已配置', () => {
    expect(isAiConfigured({ enabled: true, apiKey: 'k', baseUrl: 'https://x/v1' })).toBe(true);
    expect(isAiConfigured({ enabled: false, apiKey: 'k', baseUrl: 'https://x/v1' })).toBe(false);
    expect(isAiConfigured({ enabled: true, apiKey: '', baseUrl: 'https://x/v1' })).toBe(false);
    expect(isAiConfigured({ enabled: true, apiKey: 'k', baseUrl: '' })).toBe(false);
  });

  it('aiHost 提取主机名（用于 UI 明示"发往哪里"）', () => {
    expect(aiHost({ baseUrl: 'https://api.openai.com/v1' })).toBe('api.openai.com');
    expect(aiHost({ baseUrl: 'not a url' })).toBe('not a url');
    expect(aiHost(null)).toBe('');
  });
});

describe('normalizeAiIntent —— 白名单与越界防护', () => {
  it('未知 intent 一律拒绝', () => {
    expect(normalizeAiIntent({ intent: 'rm-rf' }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: '' }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent(null, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent('add', TASKS, '2026-10-01')).toBeNull();
  });

  it('add：必须有非空 title，否则拒绝', () => {
    expect(normalizeAiIntent({ intent: 'add' }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'add', title: '   ' }, TASKS, '2026-10-01')).toBeNull();
  });

  it('add：带上 dueDate / priority，且非法优先级被丢弃', () => {
    const r = normalizeAiIntent(
      { intent: 'add', title: '月报会议', dueDate: '2026-10-03', priority: 'z' },
      TASKS,
      '2026-10-01'
    );
    expect(r.intent).toBe('add');
    expect(r.slots.title).toBe('月报会议');
    expect(r.slots.dueDate).toBe('2026-10-03');
    expect(r.slots.priority).toBeUndefined();
    expect(r.source).toBe('ai');
    expect(r.needsConfirm).toBe(false);
  });

  it('序号越界 / 非整数 / 空清单 → 拒绝（绝不凭空造目标）', () => {
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: 0 }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: 4 }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: 1.5 }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: null }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: 'x' }, TASKS, '2026-10-01')).toBeNull();
    expect(normalizeAiIntent({ intent: 'complete', targetIndex: 1 }, [], '2026-10-01')).toBeNull();
  });

  it('需要目标时，序号映射回我们自己清单里的 id（AI 碰不到 id）', () => {
    const r = normalizeAiIntent({ intent: 'complete', targetIndex: 2 }, TASKS, '2026-10-01');
    expect(r.matches).toEqual(['t2']);
    expect(r.target).toEqual({ kind: 'index', value: 2 });
    expect(r.confidence).toBe('high');
  });

  it('add / query / undo 不接受目标（即使模型乱填也忽略）', () => {
    const q = normalizeAiIntent({ intent: 'query', targetIndex: 9 }, TASKS, '2026-10-01');
    expect(q.matches).toEqual([]);
    expect(q.target).toBeNull();
    expect(q.scope).toBe('active');

    const u = normalizeAiIntent({ intent: 'undo' }, TASKS, '2026-10-01');
    expect(u.matches).toEqual(['t1', 't2', 't3']);

    const a = normalizeAiIntent({ intent: 'add', title: 'x', targetIndex: 1 }, TASKS, '2026-10-01');
    expect(a.target).toBeNull();
    expect(a.matches).toEqual([]);
  });

  it('addContext / addProject：slotName 必需，且剥掉前缀符号', () => {
    expect(normalizeAiIntent({ intent: 'addContext', targetIndex: 1 }, TASKS, '2026-10-01')).toBeNull();
    const c = normalizeAiIntent(
      { intent: 'addContext', targetIndex: 1, slotName: '@工作' },
      TASKS,
      '2026-10-01'
    );
    expect(c.slots.context).toBe('工作');
    const p = normalizeAiIntent(
      { intent: 'addProject', targetIndex: 1, slotName: '+量化' },
      TASKS,
      '2026-10-01'
    );
    expect(p.slots.project).toBe('量化');
  });

  it('setPriority / setDue 的槽位校验', () => {
    const ok = normalizeAiIntent(
      { intent: 'setPriority', targetIndex: 1, priority: 'a' },
      TASKS,
      '2026-10-01'
    );
    expect(ok.slots.priority).toBe('A');

    const bad = normalizeAiIntent(
      { intent: 'setPriority', targetIndex: 1, priority: 'high' },
      TASKS,
      '2026-10-01'
    );
    expect(bad.slots.priority).toBeUndefined();

    const due = normalizeAiIntent(
      { intent: 'setDue', targetIndex: 1, dueDate: '2026-12-31' },
      TASKS,
      '2026-10-01'
    );
    expect(due.slots.dueDate).toBe('2026-12-31');
  });

  it('返回值与 parseIntent 同构（dispatch 不需要任何改动）', () => {
    const r = normalizeAiIntent({ intent: 'add', title: 'x' }, TASKS, '2026-10-01');
    for (const k of [
      'intent',
      'target',
      'slots',
      'matches',
      'nearMatches',
      'confidence',
      'note',
      'raw',
      'needsConfirm',
    ]) {
      expect(r).toHaveProperty(k);
    }
  });
});

describe('callAiFallback —— 只在已配置时才联网', () => {
  it('未配置 → 返回 null 且 fetch 一次都不调用', async () => {
    const fetchImpl = vi.fn();
    const r = await callAiFallback('随便一句话', { tasks: TASKS, today: '2026-10-01', fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enabled 但缺 Key → 同样不发请求', async () => {
    const fetchImpl = vi.fn();
    const r = await callAiFallback('随便一句话', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { enabled: true, apiKey: '', baseUrl: 'https://api.example.com/v1', model: 'm' },
      fetchImpl,
    });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('已配置 → 请求带 Authorization、JSON 响应格式，且模型输出被归一化', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '{"intent":"complete","targetIndex":2}' } }],
        };
      },
    }));

    const r = await callAiFallback('第二个那个搞定了', {
      tasks: TASKS,
      today: '2026-10-01',
      config: {
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-test',
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    // dev 环境走 Vite 代理绕 CORS，目标源用自定义头传递
    expect(String(url)).toContain('/ai-proxy/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['x-ai-target']).toBe('https://api.example.com/v1');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-test');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: '第二个那个搞定了' });
    // 任务清单确实进了提示词（AI 只能从这里挑序号）
    expect(body.messages[0].content).toContain('周线复盘');
    expect(body.messages[0].content).toContain('2026-10-01');

    expect(r.intent).toBe('complete');
    expect(r.matches).toEqual(['t2']);
    expect(r.raw).toBe('第二个那个搞定了');
  });

  it('模型返回非 JSON → null（不抛异常、不产出半吊子意图）', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '好的，我帮你完成。' } }] };
      },
    });
    const r = await callAiFallback('xxx', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
      fetchImpl,
    });
    expect(r).toBeNull();
  });

  it('模型返回合法 JSON 但意图越界 → null', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"intent":"formatC","targetIndex":1}' } }] };
      },
    });
    const r = await callAiFallback('xxx', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
      fetchImpl,
    });
    expect(r).toBeNull();
  });

  it('HTTP 非 2xx → 抛错（由调用方静默降级为"没听懂"）', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, async json() { return {}; } });
    await expect(
      callAiFallback('xxx', {
        tasks: TASKS,
        today: '2026-10-01',
        config: { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
        fetchImpl,
      })
    ).rejects.toThrow('401');
  });

  it('异常响应结构（无 choices）→ null', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, async json() { return {}; } });
    const r = await callAiFallback('xxx', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
      fetchImpl,
    });
    expect(r).toBeNull();
  });

  it('baseUrl 尾斜杠不会产生双斜杠路径', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"intent":"add","title":"x"}' } }] };
      },
    }));
    await callAiFallback('加一条 x', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1///', model: 'm' },
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][1].headers['x-ai-target']).toBe('https://api.example.com/v1');
  });
});

describe('testAiConnection 链路自检（分档诊断）', () => {
  const GOOD_CFG = { enabled: true, apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'm' };
  const okCompletion = (content) => async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content } }] };
    },
  });

  it('未配置 → stage=config，不发任何请求', async () => {
    const fetchImpl = vi.fn();
    const r = await testAiConnection({ enabled: false, apiKey: '', baseUrl: '', model: '' }, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('config');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('全链路成功 → stage=success，intent 来自模型', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: okCompletion('{"intent":"add","title":"测试任务"}'),
      today: '2026-10-01',
    });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('success');
    expect(r.intent.slots.title).toBe('测试任务');
    expect(r.detail).toContain('新增任务');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('HTTP 401 → stage=auth', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => ({ ok: false, status: 401, async json() { return {}; } }),
      today: '2026-10-01',
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('auth');
    expect(r.detail).toContain('401');
  });

  it('HTTP 404 → stage=model', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => ({ ok: false, status: 404, async json() { return {}; } }),
      today: '2026-10-01',
    });
    expect(r.stage).toBe('model');
  });

  it('200 但模型输出不是有效意图 → stage=format', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: okCompletion('好的，我帮你完成。'),
      today: '2026-10-01',
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('format');
    expect(r.detail).toContain('200');
  });

  it('本地代理 403（target rejected 文案）→ stage=proxy，与上游 403 区分', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() { return {}; },
        // 真 Response.clone() 是同步的，桩也要保持一致
        clone() {
          return { async text() { return 'ai-proxy: target rejected (not in allowlist / not public http[s])'; } };
        },
      }),
      today: '2026-10-01',
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('proxy');
    expect(r.detail).toContain('TODOLIST_AI_ALLOW_HOSTS');
  });

  it('上游自己的 403（无特殊文案）→ 仍按 auth 分档', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() { return {}; },
        clone() {
          return { async text() { return '{"error":"forbidden"}'; } };
        },
      }),
      today: '2026-10-01',
    });
    expect(r.stage).toBe('auth');
  });

  it('fetch 抛网络异常 → stage=network', async () => {
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
      today: '2026-10-01',
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('network');
  });

  it('超时（TimeoutError）→ stage=timeout', async () => {
    const timeoutErr = new Error('The operation timed out.');
    timeoutErr.name = 'TimeoutError';
    const r = await testAiConnection(GOOD_CFG, {
      fetchImpl: async () => {
        throw timeoutErr;
      },
      today: '2026-10-01',
    });
    expect(r.stage).toBe('timeout');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('配置归一化与边界（设置页可调的取值范围）', () => {
  const GOOD = { enabled: true, apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' };

  it('老配置升级后自动补齐超时与重试（不需要迁移脚本）', () => {
    const c = normalizeAiConfig(GOOD);
    expect(c.timeoutMs).toBe(DEFAULT_AI_CONFIG.timeoutMs);
    expect(c.maxRetries).toBe(DEFAULT_AI_CONFIG.maxRetries);
  });

  it('超时与重试被夹到合法区间（脏值不会流到运行时）', () => {
    expect(normalizeAiConfig({ ...GOOD, timeoutMs: 10 }).timeoutMs).toBe(AI_LIMITS.timeoutMs.min);
    expect(normalizeAiConfig({ ...GOOD, timeoutMs: 999999 }).timeoutMs).toBe(AI_LIMITS.timeoutMs.max);
    expect(normalizeAiConfig({ ...GOOD, maxRetries: -3 }).maxRetries).toBe(0);
    expect(normalizeAiConfig({ ...GOOD, maxRetries: 99 }).maxRetries).toBe(AI_LIMITS.maxRetries.max);
    expect(normalizeAiConfig({ ...GOOD, timeoutMs: 'abc' }).timeoutMs).toBe(DEFAULT_AI_CONFIG.timeoutMs);
    expect(normalizeAiConfig({ ...GOOD, maxRetries: 1.6 }).maxRetries).toBe(2);
  });

  it('落盘的就是归一化后的值：读到什么，将来就用什么', () => {
    saveAiConfig({ ...GOOD, timeoutMs: 1, maxRetries: 7 });
    const back = loadAiConfig();
    expect(back.timeoutMs).toBe(AI_LIMITS.timeoutMs.min);
    expect(back.maxRetries).toBe(AI_LIMITS.maxRetries.max);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('callAiFallback —— 超时与重试真的被执行', () => {
  const CFG = { enabled: true, apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' };
  const okWith = (content) => async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content } }] };
    },
  });
  const httpErr = (status) => async () => ({ ok: false, status, async json() { return {}; } });

  it('超时值取自配置，而不是写死的常量', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await callAiFallback('x', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { ...CFG, timeoutMs: 7000 },
      fetchImpl: okWith('{"intent":"add","title":"a"}'),
      maxRetries: 0,
    });
    expect(spy).toHaveBeenCalledWith(7000);
  });

  it('5xx 按配置重试，最终仍失败则抛错', async () => {
    const fetchImpl = vi.fn(httpErr(503));
    await expect(
      callAiFallback('x', {
        tasks: TASKS,
        today: '2026-10-01',
        config: { ...CFG, maxRetries: 2 },
        fetchImpl,
      })
    ).rejects.toThrow('503');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 首次 + 2 次重试
  });

  it('4xx 不重试：Key 错 / 模型名错重试只会让用户白等', async () => {
    const fetchImpl = vi.fn(httpErr(401));
    await expect(
      callAiFallback('x', {
        tasks: TASKS,
        today: '2026-10-01',
        config: { ...CFG, maxRetries: 3 },
        fetchImpl,
      })
    ).rejects.toThrow('401');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('重试成功即返回（重试是有意义的，不是走过场）', async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockImplementationOnce(httpErr(502));
    fetchImpl.mockImplementationOnce(okWith('{"intent":"add","title":"重试成功"}'));
    const r = await callAiFallback('x', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { ...CFG, maxRetries: 1 },
      fetchImpl,
    });
    expect(r.slots.title).toBe('重试成功');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('网络异常同样重试', async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    fetchImpl.mockImplementationOnce(okWith('{"intent":"add","title":"网络恢复"}'));
    const r = await callAiFallback('x', {
      tasks: TASKS,
      today: '2026-10-01',
      config: { ...CFG, maxRetries: 1 },
      fetchImpl,
    });
    expect(r.slots.title).toBe('网络恢复');
  });

  it('maxRetries=0 时只发一次请求', async () => {
    const fetchImpl = vi.fn(httpErr(500));
    await expect(
      callAiFallback('x', {
        tasks: TASKS,
        today: '2026-10-01',
        config: { ...CFG, maxRetries: 0 },
        fetchImpl,
      })
    ).rejects.toThrow('500');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('subscribeAiConfig —— 保存/清除会让界面同步刷新', () => {
  const GOOD = { enabled: true, apiKey: 'k', baseUrl: 'https://x/v1' };

  it('保存与清除都会通知订阅者，退订后不再通知', () => {
    const fn = vi.fn();
    const off = subscribeAiConfig(fn);
    saveAiConfig(GOOD);
    expect(fn).toHaveBeenCalledTimes(1);
    clearAiConfig();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    saveAiConfig(GOOD);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('单个订阅者抛异常不影响写入结果与其它订阅者', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offBad = subscribeAiConfig(bad);
    const offGood = subscribeAiConfig(good);
    expect(saveAiConfig(GOOD)).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
