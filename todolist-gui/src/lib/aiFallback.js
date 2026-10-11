// 可选 AI 兜底：只在本地规则引擎「听不懂」时，才可能把那一句话发出去。
//
// 设计约束（按重要性排序）：
//  1. 默认关闭。没配置 = 一行网络请求都不发，离线可用性不打折。
//  2. 只在本地返回 unknown 时触发。本地能认的一律不联网 —— 省 token，
//     也少一层"同一个意图有两个来源"的不确定性。
//  3. AI 不许自己造 id。它只能从我们给出的任务清单里挑序号（targetIndex），
//     序号 → id 的映射在我们这边做。AI 认错顶多是"选错条"，不会凭空改到
//     不存在的任务，也不会出现模型幻觉出来的任务名被直接写进文件。
//  4. 返回值必须与 parseIntent 同构（Intent），下游 dispatch 一行都不用改。

const CFG_KEY = 'todogui.aiFallback';

export const DEFAULT_AI_CONFIG = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  // 单次请求超时与失败重试次数：设置页可调，运行时按此执行。
  // 默认值刻意保守 —— 兜底是"锦上添花"路径，绝不能把界面卡住。
  timeoutMs: 20000,
  maxRetries: 1,
};

// 可在设置页调整的范围。设置页与运行时共用这一份，避免出现
// "界面能填、运行时当脏值丢掉"或"填了负数把超时算成 0"这类裂缝。
export const AI_LIMITS = {
  timeoutMs: { min: 3000, max: 120000 },
  maxRetries: { min: 0, max: 3 },
};

const clampInt = clampIntShared;

/**
 * 把任意来源的配置（localStorage、设置页草稿、测试桩）归一化成完整配置。
 * 所有读取点都必须过这一道，配置才不会在不同调用方手里长得不一样。
 */
export function normalizeAiConfig(cfg) {
  const c = { ...DEFAULT_AI_CONFIG, ...(cfg || {}) };
  return {
    enabled: Boolean(c.enabled),
    baseUrl: String(c.baseUrl || '').trim(),
    apiKey: String(c.apiKey || ''),
    model: String(c.model || '').trim() || DEFAULT_AI_CONFIG.model,
    timeoutMs: clampInt(c.timeoutMs, AI_LIMITS.timeoutMs, DEFAULT_AI_CONFIG.timeoutMs),
    maxRetries: clampInt(c.maxRetries, AI_LIMITS.maxRetries, DEFAULT_AI_CONFIG.maxRetries),
  };
}

// 允许 AI 返回的意图白名单 —— 与 actions.ACTIONS 的键一一对应。
// 这里显式列一份而不是 import ACTIONS，是为了让 aiFallback 保持可单独测试、
// 不被 actions 的副作用依赖拖进来。
const AI_INTENTS = new Set([
  'add',
  'complete',
  'uncomplete',
  'delete',
  'postpone',
  'setDue',
  'setPriority',
  'star',
  'addContext',
  'addProject',
  'query',
  'undo',
]);

const NO_TARGET_INTENTS = new Set(['add', 'query', 'undo']);

// —— 配置读写（localStorage）——
//
// 读写的唯一真相仍然是 localStorage（useChatAgent 每次兜底前都会重新读一遍），
// 这样才能保证「在设置页改完立刻生效」不需要任何额外同步步骤。
// 订阅只服务于界面：让状态行/设置页在配置变化后重新渲染，不参与生效逻辑。
//
// v0.1.6：读写/订阅这套动作与「联网工具」的配置完全同形，已抽到 lib/configStore.js。
// 这里保留同名导出（loadAiConfig / saveAiConfig / clearAiConfig / subscribeAiConfig），
// 调用方一行不用改 —— 抽的是实现，不是接口。
import { clampInt as clampIntShared, createConfigStore } from './configStore.js';
import { isTauri } from './runtime.js';
import { pickFetch } from './aiTransport.js';

const aiConfig = createConfigStore({
  key: CFG_KEY,
  defaults: DEFAULT_AI_CONFIG,
  normalize: normalizeAiConfig,
});

/**
 * 订阅配置变化（保存 / 清除时触发）。返回取消订阅函数。
 */
export function subscribeAiConfig(fn) {
  return aiConfig.subscribe(fn);
}

export function loadAiConfig() {
  return aiConfig.load();
}

export function saveAiConfig(cfg) {
  return aiConfig.save(cfg);
}

export function clearAiConfig() {
  return aiConfig.clear();
}

/** 本机是否落盘过 AI 配置（与"是否启用"无关，决定"能不能清除"）。 */
export function hasStoredAiConfig() {
  return aiConfig.hasStored();
}

/**
 * 是否已配置且启用（决定要不要发网络请求的唯一判据）。
 */
export function isAiConfigured(cfg) {
  const c = cfg || loadAiConfig();
  return Boolean(c && c.enabled && c.apiKey && c.baseUrl);
}

/**
 * 从 baseUrl 提取主机名，用于 UI 上"这句话会发往哪里"的明示。
 */
export function aiHost(cfg) {
  const c = cfg || loadAiConfig();
  if (!c || !c.baseUrl) return '';
  try {
    return new URL(c.baseUrl).host;
  } catch {
    return String(c.baseUrl);
  }
}

// —— 提示词 ——

function buildTaskList(tasks) {
  return (tasks || [])
    .map((t, i) => {
      const prio = t.priority ? ` (${t.priority})` : '';
      const due = t.dueDate ? ` due:${t.dueDate}` : '';
      return `${i + 1}. ${t.title}${prio}${due}`;
    })
    .join('\n');
}

function buildSystemPrompt(today, tasks) {
  return [
    '你是待办清单解析器。把用户的一句话解析成 JSON，只输出 JSON，不要任何解释或 Markdown 代码块。',
    '',
    '可用 intent（必须从中选一个）：',
    'add 新增任务 / complete 完成 / uncomplete 取消完成 / delete 删除 /',
    'postpone 延期 / setDue 设截止日 / setPriority 设优先级 / star 星标 /',
    'addContext 加@分类 / addProject 加+标签 / query 查询 / undo 撤销 / unknown 无法判断',
    '',
    '输出字段：',
    '{',
    '  "intent": "上面列出的某个值",',
    '  "targetIndex": 需要目标时填序号（整数，从 1 开始，必须来自下面的任务清单）；add/query/undo/unknown 填 null,',
    '  "title": "仅 add 使用：新任务标题（不含时间、优先级、@分类、+标签）",',
    '  "dueDate": "YYYY-MM-DD；有明确日期才填，否则 null",',
    '  "priority": "A|B|C；仅当用户明确表达优先级才填，否则 null",',
    '  "slotName": "仅 addContext/addProject 使用：分类名或标签名（不含 @ +）"',
    '}',
    '',
    '规则：',
    '- targetIndex 只能从任务清单里挑，绝不编造。清单为空时依赖目标的 intent 一律填 unknown。',
    '- 拿不准就填 unknown，不要猜。',
    `- 今天是 ${today}，"明天/后天/下周三"等要换算成具体日期。`,
    '- 用户说的是一句陈述而没有动词、但形态像待办时，填 add，并把核心内容放进 title。',
    '',
    '当前活跃任务清单：',
    buildTaskList(tasks) || '（空）',
  ].join('\n');
}

// —— 网络调用 ——

// 页面是否由本机服务（启动器的 preview/dev）提供。
// 关键：dist 构建里 import.meta.env.DEV 恒为 false，若只看 DEV 标志，
// 日常双击跑的 preview 模式会绕过本地代理直连上游，被 CORS 拦截——
// 代理在 preview 里配了也白配。判据改为「origin 是本机回环」，
// 与部署模型一致：这个应用永远由启动器服务在 localhost 上。
//
// Tauri 壳里来源是 tauri://localhost，既不是 http 也没有同源服务，
// 出机一律走壳内的 ai_chat 命令 —— 因此这里也必须判为"要走代理形态"，
// 好让 resolveEndpoint 产出带 x-ai-target 的请求，交给 aiTransport 换成 IPC。
export function isLocalOrigin() {
  try {
    if (typeof location === 'undefined') return false;
    // WHATWG URL 规范里 IPv6 的 hostname 保留方括号，两种写法都认
    return /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname);
  } catch {
    return false;
  }
}

// dev 环境走 Vite 代理绕开 CORS（第三方 API 一般不返回 Access-Control-Allow-Origin）。
// 目标源通过自定义请求头传给代理，代理侧在 vite.config.js 里读。
// 本机来源（preview）同样走代理——见 isLocalOrigin 的注释。
// Tauri 壳内由 aiTransport 把同一个请求改送到 Rust 命令，URL 形状保持一致。
function resolveEndpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  const dev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
  if (dev || isLocalOrigin() || isTauri()) {
    return { url: '/ai-proxy/chat/completions', targetHeader: base };
  }
  return { url: `${base}/chat/completions`, targetHeader: '' };
}

/**
 * 把模型返回的裸对象，校验 + 归一化成与 parseIntent 同构的 Intent。
 * 任何一处不合法都返回 null（宁可回退到"没听懂"，也不执行一个半吊子意图）。
 */
export function normalizeAiIntent(obj, tasks, today) {
  if (!obj || typeof obj !== 'object') return null;
  const intent = String(obj.intent || '').trim();
  if (!AI_INTENTS.has(intent)) return null;

  const list = Array.isArray(tasks) ? tasks : [];
  const slots = {};
  const base = {
    intent,
    target: null,
    slots,
    matches: [],
    nearMatches: [],
    confidence: 'high',
    note: null,
    raw: '',
    needsConfirm: false,
    source: 'ai',
  };

  if (intent === 'add') {
    const title = String(obj.title || '').trim();
    if (!title) return null;
    slots.title = title;
    if (obj.dueDate) slots.dueDate = String(obj.dueDate).trim();
    if (obj.priority && /^[A-C]$/.test(String(obj.priority).trim().toUpperCase())) {
      slots.priority = String(obj.priority).trim().toUpperCase();
    }
    return { ...base, slots };
  }

  if (NO_TARGET_INTENTS.has(intent)) {
    if (intent === 'query') return { ...base, scope: 'active' };
    return { ...base, matches: list.map((t) => t.id) };
  }

  // 需要目标：号数必须落在清单范围内。
  const idx = Number(obj.targetIndex);
  if (!Number.isInteger(idx) || idx < 1 || idx > list.length) return null;
  const task = list[idx - 1];

  if (intent === 'addContext' || intent === 'addProject') {
    const name = String(obj.slotName || '').trim().replace(/^[@+]/, '');
    if (!name) return null;
    slots[intent === 'addContext' ? 'context' : 'project'] = name;
  }
  if (intent === 'setPriority') {
    const p = String(obj.priority || '').trim().toUpperCase();
    if (/^[A-C]$/.test(p)) slots.priority = p;
  }
  if (intent === 'postpone' || intent === 'setDue') {
    if (obj.dueDate) slots.dueDate = String(obj.dueDate).trim();
  }

  return {
    ...base,
    target: { kind: 'index', value: idx },
    slots,
    matches: [task.id],
  };
}

// 哪些失败值得重试：5xx 与网络/超时属于"这次运气不好"，重试有意义；
// 4xx 是"请求本身不对"（Key 错、模型名错、路径错），重试只会重复挨同一句骂，
// 还会把用户的等待时间翻倍。
function isRetriable(err) {
  const msg = String((err && err.message) || err);
  const m = msg.match(/HTTP (\d{3})/);
  if (m) return Number(m[1]) >= 500;
  return true;
}

/**
 * 调用 AI 兜底解析。
 * @param {string} text 用户原始输入
 * @param {{tasks?:Array, today?:string, config?:object, fetchImpl?:Function,
 *          timeoutMs?:number, maxRetries?:number}} opts
 *   timeoutMs / maxRetries 仅用于覆盖配置（自检与测试用）
 * @returns {Promise<object|null>} Intent 或 null
 */
export async function callAiFallback(text, opts = {}) {
  const cfg = normalizeAiConfig(opts.config || loadAiConfig() || {});
  if (!isAiConfigured(cfg)) return null;

  const tasks = Array.isArray(opts.tasks) ? opts.tasks : [];
  const today = opts.today || '';
  // 出机通道按运行时选：浏览器 = 全局 fetch（行为与迁移前完全一致），
  // Tauri = 壳里的 ai_chat 命令。测试仍可通过 fetchImpl 注入。
  const doFetch = opts.fetchImpl || pickFetch();

  const endpoint = resolveEndpoint(cfg.baseUrl);
  if (!endpoint) return null;

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (endpoint.targetHeader) headers['x-ai-target'] = endpoint.targetHeader;

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : cfg.timeoutMs;
  const retries = Number.isInteger(opts.maxRetries) ? Math.max(0, opts.maxRetries) : cfg.maxRetries;

  const body = JSON.stringify({
    model: cfg.model || DEFAULT_AI_CONFIG.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(today, tasks) },
      { role: 'user', content: String(text || '') },
    ],
  });

  // 兜底请求不该让界面卡住：超时就直接放弃，退回"没听懂"。
  // 每次尝试都要重建 signal —— AbortSignal.timeout 是一次性的。
  const attemptOnce = async () => {
    let signal;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      signal = AbortSignal.timeout(timeoutMs);
    }

    const res = await doFetch(endpoint.url, { method: 'POST', headers, signal, body });

    if (!res || !res.ok) {
      throw new Error(`AI 兜底请求失败：HTTP ${res ? res.status : 'unknown'}`);
    }

    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
    let parsed;
    try {
      parsed = JSON.parse(String(content || '').trim());
    } catch {
      return null;
    }
    const normalized = normalizeAiIntent(parsed, tasks, today);
    if (normalized) normalized.raw = String(text || '');
    return normalized;
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await attemptOnce();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetriable(err)) throw err;
    }
  }
  throw lastErr;
}

// —— 链路自检（应用内「测试连接」按钮用）——
//
// AI 兜底是「最需要它时才第一次真跑」的路径：平时静默，用的时候才发现
// 代理不通 / Key 失效 / 模型名写错就晚了。这里用与 callAiFallback 完全相同的
// 请求路径发一条测试句，把结果分档报告，让问题在配置时暴露而不是使用时。
// 2026-10-06 的教训：代理的 router 选项从未生效过，全绿测试与成功构建都
// 发现不了这种「配置层静默失效」——所以必须有真发请求的端到端自检。
const TEST_SENTENCE = '加一条 测试任务';
const TEST_TASKS = [{ id: 't-test', title: '样例任务' }];

function describeIntent(intent) {
  const s = (intent && intent.slots) || {};
  const bits = [];
  if (s.title) bits.push(`「${s.title}」`);
  if (s.dueDate) bits.push(`截止 ${s.dueDate}`);
  if (s.priority) bits.push(`优先级 ${s.priority}`);
  const label = {
    add: '新增任务',
    complete: '完成任务',
    uncomplete: '取消完成',
    delete: '删除任务',
    postpone: '延期',
    setDue: '设截止日',
    setPriority: '设优先级',
    star: '星标',
    addContext: '加分类',
    addProject: '加标签',
    query: '查询',
    undo: '撤销',
  }[intent && intent.intent] || (intent && intent.intent) || '未知意图';
  return `${label} ${bits.join(' ')}`.trim();
}

/**
 * 对 AI 兜底链路做一次端到端自检。
 * 复用 callAiFallback 的真实请求路径（代理 → 鉴权 → 模型 → JSON 解析），
 * 不另造第二条链路——测的就是以后真正会走的那条。
 * @param {object} [cfg] 未传时读 localStorage 配置；UI 会传表单当前值（未保存也能测）
 * @param {{fetchImpl?:Function, today?:string, timeoutMs?:number, maxRetries?:number}} [opts]
 * @returns {Promise<{ok:boolean, stage:string, detail:string, latencyMs:number, intent?:object}>}
 *   stage: config|proxy|timeout|auth|model|request|upstream|network|format|success
 */
export async function testAiConnection(cfg, opts = {}) {
  const c = normalizeAiConfig(cfg || loadAiConfig() || {});
  const t0 = Date.now();
  if (!isAiConfigured(c)) {
    return {
      ok: false,
      stage: 'config',
      detail: '还没有配置：需要打开「启用」，并填写服务地址和 API Key。',
      latencyMs: 0,
    };
  }

  let status = null;
  let proxyRejected = false;
  const recordingFetch = async (url, init) => {
    const res = await (opts.fetchImpl || fetch)(url, init);
    status = res ? res.status : null;
    if (res && res.status === 403) {
      // 本地代理拒绝内网目标时返回 403 + 固定文案；与上游自己的 403 区分开
      try {
        const body = await res.clone().text();
        if (body.includes('target rejected')) proxyRejected = true;
      } catch {
        // 忽略读取失败，按普通 403 处理
      }
    }
    return res;
  };

  let intent = null;
  let err = null;
  try {
    intent = await callAiFallback(TEST_SENTENCE, {
      tasks: TEST_TASKS,
      today: opts.today || new Date().toISOString().slice(0, 10),
      config: c,
      fetchImpl: recordingFetch,
      // 自检走的就是以后真正会走的那条路：同样的超时、同样的重试策略。
      // 只放宽总时长，不改变链路形状 —— 否则测过的和用的不是同一件事。
      timeoutMs: opts.timeoutMs || c.timeoutMs,
      maxRetries: Number.isInteger(opts.maxRetries) ? opts.maxRetries : c.maxRetries,
    });
  } catch (e) {
    err = e;
  }
  const latencyMs = Date.now() - t0;

  if (proxyRejected) {
    return {
      ok: false,
      stage: 'proxy',
      detail:
        '本地代理拒绝了该目标：服务地址指向回环/内网网段。若是有意使用本地大模型，'
        + '启动应用前设置环境变量 TODOLIST_AI_ALLOW_HOSTS=localhost,127.0.0.1（逗号分隔主机名）。',
      latencyMs,
    };
  }
  if (err) {
    const msg = String((err && err.message) || err);
    if (/HTTP 40[13]\b/.test(msg)) {
      return { ok: false, stage: 'auth', detail: `认证被拒绝（${msg}）。检查 API Key 是否正确、账户是否有余额/权限。`, latencyMs };
    }
    if (/HTTP 404\b/.test(msg)) {
      return { ok: false, stage: 'model', detail: `接口或模型不存在（HTTP 404）。检查服务地址是否为 OpenAI 兼容接口、模型名拼写是否正确。`, latencyMs };
    }
    if (/HTTP 4\d\d\b/.test(msg)) {
      return { ok: false, stage: 'request', detail: `请求被上游拒绝（${msg}）。检查 baseUrl 路径与请求参数。`, latencyMs };
    }
    if (/HTTP 5\d\d\b/.test(msg)) {
      return { ok: false, stage: 'upstream', detail: `上游服务端错误（${msg}）。服务商侧问题，稍后重试。`, latencyMs };
    }
    if ((err && err.name === 'TimeoutError') || /timed?\s*out|abort/i.test(msg)) {
      return { ok: false, stage: 'timeout', detail: `请求超时（${latencyMs}ms）。检查网络与上游服务可用性。`, latencyMs };
    }
    return { ok: false, stage: 'network', detail: `网络不可达（${msg}）。检查网络；非本机来源打开时还可能是上游未放行 CORS。`, latencyMs };
  }
  if (!intent) {
    return {
      ok: false,
      stage: 'format',
      detail: `网络已通（HTTP ${status}），但模型返回无法解析为有效意图。确认该模型支持 JSON 输出、baseUrl 指向 OpenAI 兼容的 /chat/completions 接口。`,
      latencyMs,
    };
  }
  return {
    ok: true,
    stage: 'success',
    detail: `链路正常（${latencyMs}ms）：模型把「${TEST_SENTENCE}」解析为 → ${describeIntent(intent)}`,
    latencyMs,
    intent,
  };
}
