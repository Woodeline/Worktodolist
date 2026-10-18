// nlRules 纯函数测试（零新增依赖，node 环境）。
import { describe, expect, it } from 'vitest';
import { detectAction, extractDate, parseIntent } from './nlRules.js';
import { parseFile } from './todoParser.js';

const TODAY = '2026-10-01';

// 与真实 todo.txt 一致的数据集（活跃任务，文件行序）。
const TODO_FIXTURE = [
  '(A) 2026-09-20 逾期任务：季报复核 due:2026-09-25',
  '(B) 2026-09-20 今天到期：写第 10 周回测报告 due:2026-09-30',
  '(C) 2026-09-20 有项目标签的任务 +回测 due:2026-10-10',
  '(D) 2026-09-20 星标任务 star:1',
  '(E) 2026-09-20 未来才开始的任务 t:2026-10-05',
  '(F) 2026-09-20 普通任务没有任何标签',
  '2026-09-30 带上下文的任务 @工作 +量化 due:2026-10-08',
  '2026-09-30 收集箱任务：无任何标记的裸任务',
  '(B) 2026-09-30 带截止日的周线复盘 @投资 +复盘 due:2026-10-04',
].join('\n');

const TASKS = parseFile(TODO_FIXTURE).filter((e) => e.kind === 'task' && !e.completed);

function run(text) {
  return parseIntent(text, { tasks: TASKS, today: TODAY });
}

describe('detectAction - 动作识别与优先级', () => {
  it('基本动作词', () => {
    expect(detectAction('加一条 明天 交周报')).toBe('add');
    expect(detectAction('完成 回测报告')).toBe('complete');
    expect(detectAction('搞定 回测报告')).toBe('complete');
    expect(detectAction('取消完成 回测报告')).toBe('uncomplete');
    expect(detectAction('恢复 回测报告')).toBe('uncomplete');
    expect(detectAction('删除 回测报告')).toBe('delete');
    expect(detectAction('把 回测报告 延到下周三')).toBe('postpone');
    expect(detectAction('标为高 回测报告')).toBe('setPriority');
    expect(detectAction('截止 周五 交报告')).toBe('setDue');
    expect(detectAction('星标 回测报告')).toBe('star');
    expect(detectAction('有哪些任务')).toBe('query');
    expect(detectAction('撤销')).toBe('undo');
    expect(detectAction('今天天气怎么样')).toBe('unknown');
  });

  it('“取消完成”优先于“完成”', () => {
    expect(detectAction('取消完成 A')).toBe('uncomplete');
  });
});

describe('extractDate - 时间词解析', () => {
  const d = (t) => extractDate(t, TODAY).date;
  it('相对日', () => {
    expect(d('今天')).toBe('2026-10-01');
    expect(d('明天')).toBe('2026-10-02');
    expect(d('后天')).toBe('2026-10-03');
    expect(d('大后天')).toBe('2026-10-04');
    expect(d('3天后')).toBe('2026-10-04');
    expect(d('2周后')).toBe('2026-10-15');
  });

  it('星期（今天为 2026-10-01 周四）', () => {
    expect(d('下周三')).toBe('2026-10-07');
    expect(d('本周五')).toBe('2026-10-02');
    expect(d('周五')).toBe('2026-10-02');
    expect(d('周一')).toBe('2026-10-05'); // 本周一已过 → 下周一
    expect(d('下下周一')).toBe('2026-10-12');
  });

  it('绝对日期与月末', () => {
    expect(d('2026-12-25')).toBe('2026-12-25');
    expect(d('10月5日')).toBe('2026-10-05');
    expect(d('月底')).toBe('2026-10-31');
    expect(d('下月初')).toBe('2026-11-01');
    expect(d('随便说点什么')).toBe(null);
  });
});

describe('parseIntent - 意图与目标', () => {
  it('add：提取标题与截止日，忽略时刻', () => {
    const r = run('加一条 明天下午 交周报');
    expect(r.intent).toBe('add');
    expect(r.slots.title).toBe('交周报');
    expect(r.slots.dueDate).toBe('2026-10-02');
    expect(r.note).toContain('已按日期处理');
    expect(r.confidence).toBe('high');
  });

  it('complete：唯一关键词命中', () => {
    const r = run('完成 回测报告');
    expect(r.intent).toBe('complete');
    expect(r.matches).toHaveLength(1);
    expect(r.confidence).toBe('high');
  });

  it('complete：多命中 → 低置信度交澄清', () => {
    const r = run('完成 任务');
    expect(r.intent).toBe('complete');
    expect(r.matches.length).toBeGreaterThan(1);
    expect(r.confidence).toBe('low');
  });

  it('序号目标', () => {
    const r = run('完成 第2条');
    expect(r.target).toEqual({ kind: 'index', value: 2 });
    expect(r.matches).toHaveLength(1);
    expect(r.confidence).toBe('high');
  });

  it('分类目标：“完成 @工作 里的任务” 唯一未完成 → 高置信度', () => {
    const r = run('完成 @工作 里的任务');
    expect(r.target.kind).toBe('context');
    expect(r.target.value).toBe('工作');
    expect(r.matches).toHaveLength(1);
    expect(r.confidence).toBe('high');
  });

  it('postpone：把 X 延到下周三', () => {
    const r = run('把 回测报告 延到下周三');
    expect(r.intent).toBe('postpone');
    expect(r.slots.dueDate).toBe('2026-10-07');
    expect(r.matches).toHaveLength(1);
  });

  it('setPriority：标为高 X', () => {
    const r = run('标为高 回测报告');
    expect(r.intent).toBe('setPriority');
    expect(r.slots.priority).toBe('A');
    expect(r.matches).toHaveLength(1);
  });

  it('setDue：截止 周五 X', () => {
    const r = run('截止 周五 回测报告');
    expect(r.intent).toBe('setDue');
    expect(r.slots.dueDate).toBe('2026-10-02');
  });

  it('addContext：归到 @工作', () => {
    const r = run('把 回测报告 归到 @工作');
    expect(r.intent).toBe('addContext');
    expect(r.slots.context).toBe('工作');
    expect(r.matches).toHaveLength(1);
  });

  it('query / undo', () => {
    expect(run('有哪些任务').intent).toBe('query');
    expect(run('撤销').intent).toBe('undo');
  });

  it('unknown：无动作词、无副作用意图', () => {
    const r = run('今天天气怎么样');
    expect(r.intent).toBe('unknown');
    expect(r.matches).toEqual([]);
    expect(r.confidence).toBe('low');
  });

  it('关键词 0 命中 → 低置信度', () => {
    const r = run('完成 不存在的任务xyz');
    expect(r.matches).toHaveLength(0);
    expect(r.confidence).toBe('low');
  });
});

describe('query 前缀优先与 scope', () => {
  it('“有哪些任务已完成” → query(done)，不再误判为 complete', () => {
    const r = run('有哪些任务已完成');
    expect(r.intent).toBe('query');
    expect(r.scope).toBe('done');
  });

  it('“列出今天的任务” → query(active)', () => {
    const r = run('列出今天的任务');
    expect(r.intent).toBe('query');
    expect(r.scope).toBe('active');
  });

  it('“完成 回测周报” → 仍是 complete', () => {
    const r = run('完成 回测周报');
    expect(r.intent).toBe('complete');
  });

  it('“查一下 @工作的任务” → query(active) 且带 @工作 过滤', () => {
    const r = run('查一下 @工作的任务');
    expect(r.intent).toBe('query');
    expect(r.scope).toBe('active');
    expect(r.slots.context).toBe('工作');
  });

  it('反向用例：带明确目标的命令不被查询前缀抢占', () => {
    expect(run('搞定 第2条').intent).toBe('complete');
    expect(run('完成 回测报告').intent).toBe('complete');
    expect(run('完成 任务清单整理').intent).toBe('complete');
  });
});

describe('R2：命令触发词优先（标题含查询动词的新增不得被抢为 query）', () => {
  it('带 add 触发词的句子即使标题含查询动词仍是 add', () => {
    for (const t of ['加一条 列出购物清单', '加一条 逾期账单提醒', '新增 查看体检报告', '记一下 搜索优化方案', '加 查看统计']) {
      const r = run(t);
      expect(r.intent).toBe('add');
      expect(r.slots.title).toBeTruthy();
    }
  });

  it('命令前缀（删除/完成）不被查询词抢占', () => {
    expect(run('删除 列出 的任务').intent).toBe('delete');
    expect(run('完成 查看报告').intent).toBe('complete');
    expect(run('勾掉 看看报告').intent).toBe('complete');
  });
});

describe('R2-2：query 残余关键词与澄清', () => {
  it('「列出 回测」→ query 且 keyword=回测', () => {
    const r = run('列出 回测');
    expect(r.intent).toBe('query');
    expect(r.scope).toBe('active');
    expect(r.slots.keyword).toBe('回测');
  });

  it('「列出 完全不存在的任务名」→ query 且带残余关键词（0 命中交由澄清）', () => {
    const r = run('列出 完全不存在的任务名');
    expect(r.intent).toBe('query');
    expect(r.slots.keyword).toBeTruthy();
  });

  it('「已完成 回测报告」→ 有明确目标，交回 complete', () => {
    const r = run('已完成 回测报告');
    expect(r.intent).toBe('complete');
    expect(r.matches).toHaveLength(1);
  });

  it('「已完成」（无目标）→ query(scope=done)', () => {
    const r = run('已完成');
    expect(r.intent).toBe('query');
    expect(r.scope).toBe('done');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3：隐式新增（内容式输入）
//
// 根因：旧引擎把"用户先说动词"当成前提，但人写待办是内容式的 ——
// 「后天上午9点有月报会议要开」句中没有动词，于是掉进 unknown。
// 修法不是继续扩词表（口语变体是指数级的），而是补一条结构性判据：
// 一句话能解析出"任务式时间"且不是疑问句，就当作待办候选 —— 但只产出
// 「建议」，绝不直接落盘。
// ─────────────────────────────────────────────────────────────────────────────
describe('R3：隐式新增 suggestAdd', () => {
  const IMPLICIT = [
    '后天上午9点有月报会议要开',
    '明天要交周报',
    '下周三去医院复查',
    '周五下午三点跟客户开会',
    '10月8日项目验收',
  ];

  it('句中没有动词、但带任务式时间 → suggestAdd（而不是 unknown）', () => {
    for (const t of IMPLICIT) {
      const r = run(t);
      expect(r.intent, `「${t}」应为 suggestAdd，实得 ${r.intent}`).toBe('suggestAdd');
    }
  });

  it('suggestAdd 必须带 needsConfirm=true 且 title 非空（只建议，不执行）', () => {
    for (const t of IMPLICIT) {
      const r = run(t);
      expect(r.needsConfirm, `「${t}」needsConfirm 应为 true`).toBe(true);
      expect(String(r.slots.title || '').trim(), `「${t}」title 不应为空`).not.toBe('');
      expect(r.matches).toEqual([]);
    }
  });

  it('时间被抽成 dueDate，且从标题里剥掉', () => {
    const r = run('后天上午9点有月报会议要开');
    expect(r.intent).toBe('suggestAdd');
    expect(r.slots.dueDate).toBe('2026-10-03');
    expect(r.slots.title).toContain('月报会议');
    expect(r.slots.title).not.toContain('后天');
    expect(r.note).toContain('已按日期处理'); // 有日期 + 有具体时刻
  });

  it('疑问句不是待办', () => {
    for (const t of ['明天要开会吗', '后天有没有会议？', '下周三怎么办', '明天几点开会呢']) {
      expect(run(t).intent, `「${t}」不该被当成待办`).not.toBe('suggestAdd');
    }
  });

  it('没有时间表达 → 不猜（仍是 unknown）', () => {
    expect(run('随便一句没有时间的话').intent).toBe('unknown');
  });

  it('剥完时间和虚词什么都不剩 → 不猜（仍是 unknown）', () => {
    for (const t of ['明天', '后天吧', '记得明天']) {
      expect(run(t).intent, `「${t}」不该产出空标题待办`).not.toBe('suggestAdd');
    }
  });

  it('显式命令不会被隐式新增抢走', () => {
    expect(run('加一条 明天 交周报').intent).toBe('add');
    expect(run('完成 明天 交周报').intent).toBe('complete');
    // 「记得」本身是 add 的显式触发词 → 直接落 add，不需要再反问一次
    const r = run('记得月底前把发票报销了');
    expect(r.intent).toBe('add');
    expect(r.needsConfirm).toBe(false);
    expect(r.slots.title).toContain('发票');
  });

  it('回归：单字查询词不得抢占内容（「复查」不是「查任务」）', () => {
    // 曾经 QUERY_CONTAINS_RE 里有一个裸的 `查`，「下周三去医院复查」被判成 query
    expect(detectAction('下周三去医院复查')).not.toBe('query');
    const r = run('下周三去医院复查');
    expect(r.intent).toBe('suggestAdd');
    expect(r.slots.title).toContain('复查');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3-2：句首权重 —— 命令必须出现在句首窗口
//
// 「12月31日前完成年报」里的"完成"前面已有一个时间表达，它修饰的是内容，
// 不是命令；旧引擎会把它抢成 complete 然后去改一条叫"12月31日前完成年报"的任务。
// ─────────────────────────────────────────────────────────────────────────────
describe('R3-2：句首窗口与时间前置降级', () => {
  it('触发词出现在句中且前面已有时间 → 不当作命令', () => {
    const r = run('12月31日前完成年报');
    expect(r.intent).not.toBe('complete');
  });

  it('时间在句子开头、命令也在开头 → 仍识别为命令', () => {
    expect(detectAction('完成 明天 交周报')).toBe('complete');
    expect(detectAction('删除 下周的会议')).toBe('delete');
  });

  it('句首窗口内的命令不受影响（窗口 8 字）', () => {
    expect(detectAction('帮我 完成 回测报告')).toBe('complete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3-3：两档候选（matches 强匹配 / nearMatches 弱匹配）
//
// 只有一档时，「把那个报告延到下周」会得到一个空的候选列表，
// 用户看到的是"请确认："后面什么都没有。
// ─────────────────────────────────────────────────────────────────────────────
describe('R3-3：强匹配 / 弱匹配两档候选', () => {
  it('精准命中 → 进 matches，nearMatches 不重复收录', () => {
    const r = run('完成 回测报告');
    expect(r.matches.length).toBe(1);
    const overlap = r.nearMatches.filter((id) => r.matches.includes(id));
    expect(overlap).toEqual([]);
  });

  it('含糊指代 → matches 可能为空，但 nearMatches 要有东西可展示', () => {
    const r = run('把那个报告延到下周三');
    expect(r.intent).toBe('postpone');
    expect(r.matches.length + r.nearMatches.length).toBeGreaterThan(0);
  });

  it('完全无关的查询 → 两档都空（不硬凑候选）', () => {
    const r = run('完成 完全不存在的任务xyz');
    expect(r.matches).toEqual([]);
    expect(r.nearMatches).toEqual([]);
  });

  it('所有意图返回点都带 nearMatches 字段（下游可无脑读取）', () => {
    for (const t of ['加一条 明天 交周报', '有哪些任务', '撤销', '完成 回测报告', '列一下']) {
      expect(run(t)).toHaveProperty('nearMatches');
    }
  });

  it('满分档否决：标题被原样打出来时，模糊命中不得把它稀释成"需要澄清"', () => {
    // 「回测报告复核」与「写第 10 周回测报告」对查询「回测报告复核」分别得 1.0 与 0.5。
    // 只看阈值会把两条都收进 matches → 变成"请回复序号"。但用户明明把标题原样打了出来。
    const tasks = [
      { id: 'x1', kind: 'task', title: '写第 10 周回测报告', completed: false, contexts: [], projects: [] },
      { id: 'x2', kind: 'task', title: '回测报告复核', completed: false, contexts: [], projects: [] },
    ];
    const r = parseIntent('把 回测报告复核 延后', { tasks, today: TODAY });
    expect(r.intent).toBe('postpone');
    expect(r.matches).toEqual(['x2']);
    expect(r.confidence).toBe('high');
    expect(r.nearMatches).toContain('x1'); // 模糊那条降级为弱候选，而不是消失
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3-4：片段假象 —— 唯一命中也不代表可以直接执行
//
// 「完成 报告」只命中 1 条，但这个唯一性是假象：查询词"报告"在标题里是
// "回测报告"的后半截。直接执行等于替用户做了决定。
// ─────────────────────────────────────────────────────────────────────────────
describe('R3-4：唯一命中但查询词只是片段 → needsConfirm', () => {
  it('「完成 报告」唯一命中仍是片段 → needsConfirm=true', () => {
    const r = run('完成 报告');
    expect(r.matches.length).toBe(1);
    expect(r.needsConfirm).toBe(true);
  });

  it('查询词本身够长（≥3 汉字）→ 不需要额外确认', () => {
    const r = run('完成 回测报告');
    expect(r.matches.length).toBe(1);
    expect(r.needsConfirm).toBe(false);
  });

  it('序号 / 分类目标不触发片段判定', () => {
    expect(run('完成 第2条').needsConfirm).toBe(false);
    expect(run('完成 @工作 里的任务').needsConfirm).toBe(false);
  });

  it('所有意图返回点都带 needsConfirm 字段', () => {
    for (const t of ['加一条 明天 交周报', '有哪些任务', '撤销', '完成 回测报告', '列一下']) {
      expect(run(t)).toHaveProperty('needsConfirm');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3-5：时间表达的边界扩充（周范围词 / 中文数字 / 口语偏移）
// ─────────────────────────────────────────────────────────────────────────────
describe('R3-5：extractDate 扩充边界', () => {
  const d = (t) => extractDate(t, TODAY).date;
  // 允许指定不同的"今天"，用于验证周末/周范围词在各种星期几下的边界
  const d0 = (t, today) => extractDate(t, today).date;

  it('中文数字相对日', () => {
    expect(d('三天后')).toBe('2026-10-04');
    expect(d('两天后')).toBe('2026-10-03');
    expect(d('十天后')).toBe('2026-10-11');
  });

  it('周范围词：下周 / 本周 / 周末', () => {
    expect(d('下周')).toBe('2026-10-11'); // 下周日
    // 「周末」取周六（今天周四 → 本周六 10-03）。
    // 这是个有歧义的词：也可以理解成"周日"（周末的最后一天）。
    // 引擎选周六 = "在周末开始前做完"，语义上更接近待办的截止感。
    // 与「周末」同口径：都取周六
    expect(d('周末')).toBe('2026-10-03');
    expect(d('下周末')).toBe('2026-10-10');
  });

  it('周末边界：今天为周六 / 周日 / 周一（修复「这周末」落到过去）', () => {
    // 今天 = 周六（2026-10-03）：本周六就是今天，不得早于今天
    expect(d0('这周末', '2026-10-03')).toBe('2026-10-03');

    // 今天 = 周日（2026-10-04）：周日已经落在周末里，「这/本周末」必须 clamp 到今天，
    // 不能退回昨天（那会让任务一建立就显示 ⚠逾期）；而「周末」（无前缀）找最近的周六 → 下周六
    expect(d0('这周末', '2026-10-04')).toBe('2026-10-04');
    expect(d0('本周末', '2026-10-04')).toBe('2026-10-04');
    expect(d0('周末', '2026-10-04')).toBe('2026-10-10');

    // 今天 = 周一（2026-10-05）：本周六尚未到 → 本周六
    expect(d0('这周末', '2026-10-05')).toBe('2026-10-10');
  });

  it('「下周」不会抢走「下周三」', () => {
    expect(d('下周三')).toBe('2026-10-07');
    expect(d('下下周三')).toBe('2026-10-14');
  });

  it('口语偏移词', () => {
    expect(d('往后挪一周')).toBe('2026-10-08');
    expect(d('推迟两周')).toBe('2026-10-15');
  });

  it('「第 10 周回测报告」里的"周"不是时间', () => {
    expect(d('第 10 周回测报告')).toBe(null);
  });

  it('无时间表达 → null', () => {
    expect(d('随便说点什么')).toBe(null);
  });
});


describe('长尾识别 - 第四轮盲测固化的行为', () => {
  it('完成体：句末「V了 / V过了」是回报进度，不是新建', () => {
    expect(detectAction('差旅报销我报过了')).toBe('complete');
    expect(detectAction('电话那条帮我回了')).toBe('complete');
    // 反例：时刻在后、动词在前的"回电"仍是新增内容
    expect(detectAction('明天 回复客户')).not.toBe('complete');
  });

  it('取消类口语：不用去了 / 作废 都算删除', () => {
    expect(detectAction('约牙医洗牙 不用去了')).toBe('delete');
    expect(detectAction('这单子作废')).toBe('delete');
  });

  it('优先级可以只说重要性，不说 A/B/C', () => {
    const g = run('帮我把 洗牙 标成要紧的');
    expect(g.intent).toBe('setPriority');
    expect(g.slots.priority).toBe('A');
  });

  it('时长上限「N天内」是截止日，裸「三天」不是', () => {
    expect(extractDate('三天内 写完材料', TODAY).date).toBe('2026-10-04');
    expect(extractDate('弄它个三天', TODAY).date).toBe(null);
  });

  it('疑问框架不污染关键词，也不被句中的"到期"抢成 setDue', () => {
    const overdue = run('哪些事拖到期了');
    expect(overdue.intent).toBe('query');
    expect(overdue.scope).toBe('overdue');
    expect(overdue.slots.keyword).toBeUndefined();

    const withCtx = run('工作里还有啥没办');
    expect(withCtx.intent).toBe('query');
    expect(withCtx.slots.context).toBe('工作');
    expect(withCtx.slots.keyword).toBeUndefined();
  });
});

describe('多动作单句拆分', () => {
  const mem = { lastTaskId: 'k1', lastCandidates: [] };
  const run5 = (text) => parseIntent(text, { tasks: TASKS, today: TODAY, memory: mem });

  it('一句两件事 → intent=multi，且各子动作独立解析（含各自的槽位）', () => {
    const g = run5('把 回测报告 删了，顺便把 周线复盘 延到下周三');
    expect(g.intent).toBe('multi');
    expect(g.needsConfirm).toBe(true);
    const items = g.slots.items;
    expect(items.map((i) => i.intent)).toEqual(['delete', 'postpone']);
    expect(items[1].slots.dueDate).toBe('2026-10-07');
  });

  it('同一件事换着说两遍 → 不拆（「要紧，顶格」仍是一条 setPriority）', () => {
    const g = run5('回测这条要紧，顶格');
    expect(g.intent).toBe('setPriority');
  });

  it('后半句没有动作 → 不拆（「删了，就是昨天说的那条」仍是一条 delete）', () => {
    const g = run5('把 回测报告 删了，就是昨天说的那条');
    expect(g.intent).toBe('delete');
  });

  it('无分隔连写：「把A删了把B标成高」按「把」的重复切句', () => {
    const g = run5('把季报复核删了把周线复盘标成高');
    expect(g.intent).toBe('multi');
    expect(g.slots.items.map((i) => i.intent)).toEqual(['delete', 'setPriority']);
  });

  it('无分隔但目标锁不到 → 不拆（「把伞收了把鞋换了」列表里没这两样）', () => {
    const g = run5('把伞收了把鞋换了');
    expect(g.intent).not.toBe('multi');
  });

  it('改口不是第二件事：「删了就是把B那条删了」仍是一条 delete', () => {
    expect(run5('把季报复核删了就是把周线复盘那条删了').intent).toBe('delete');
    expect(run5('把季报复核删了，就是周线复盘那条').intent).toBe('delete');
  });

  it('同一意图、不同目标 → 算两件事（「把A删了，把B也删了」）', () => {
    const g = run5('把季报复核删了，把周线复盘也删了');
    expect(g.intent).toBe('multi');
    expect(g.slots.items.map((i) => i.intent)).toEqual(['delete', 'delete']);
  });

  it('孤立副词「也」不污染目标：「把这条也标成高」走回指而非关键词', () => {
    const g = run5('把这条也标成高');
    expect(g.intent).toBe('setPriority');
    expect(g.target.kind).toBe('ref');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 第七轮盲测固化的行为。
//
// 这一轮首跑只有 74.2%（正向）/ 50%（该保守的），其中两条是安全级失败：
// 否定句与征询句会被当成命令**直接改文件**。下面每个 it 都对应一处当时的缺陷，
// 并且成对写了"反向断言"——护栏最容易犯的错是掐死本来正常的说法
// （「租约不要了」里的"不要了"是 delete 触发词，不是否定）。
// ─────────────────────────────────────────────────────────────────────────────
describe('R7-1：极性护栏（否定句 / 征询句不得执行）', () => {
  it('否定句：动词认出来了也不动手，回 refused=negated', () => {
    for (const t of ['不要完成 季报复核', '别把周线复盘删了', '不要把回测报告标为高']) {
      const g = run(t);
      expect(g.intent, `「${t}」不该被当成命令`).toBe('unknown');
      expect(g.refused, `「${t}」`).toBe('negated');
      expect(g.matches).toEqual([]);
    }
  });

  it('征询句：在问意见不是下命令，回 refused=consult', () => {
    for (const t of ['要不要把周线复盘延到下周？', '季报复核是不是该删了', '你说回测报告要不要延后']) {
      const g = run(t);
      expect(g.intent, `「${t}」不该被当成命令`).toBe('unknown');
      expect(g.refused, `「${t}」`).toBe('consult');
    }
  });

  // —— 反向断言：护栏不许掐死正常说法 ——
  it('「不要了 / 不用了」本身是 delete 触发词，不能被自己的护栏掐死', () => {
    expect(run('回测报告这条不要了').intent).toBe('delete');
    expect(run('周线复盘 不用做了').intent).toBe('delete');
    expect(detectAction('约牙医洗牙 不用去了', TODAY, [])).toBe('delete');
  });

  it('句尾的「别忘了」是否定词，但命令在句首 → 仍是 add', () => {
    expect(run('加一条 明天 交周报，别忘了').intent).toBe('add');
  });

  it('复合词里的「别」不是否定：特别 / 级别 / 别墅', () => {
    expect(run('把特别重要的季报复核标为高').intent).toBe('setPriority');
    expect(run('把季报复核的级别设为A').intent).toBe('setPriority');
    expect(run('把特别重要的季报复核标为高').refused).toBeUndefined();
  });

  it('只读意图不受护栏影响：查询照常走', () => {
    expect(run('有哪些没做完的任务').intent).toBe('query');
    expect(run('有哪些没做完的任务').refused).toBeUndefined();
  });
});

describe('R7-2：优先级说法不得残留在关键词里', () => {
  const idOf = (frag) => TASKS.find((t) => t.title.includes(frag)).id;

  it('连写的「最高优先级」要剥干净，否则相似度掉到阈值以下、目标反而找不到', () => {
    const g = run('周线复盘标成最高优先级');
    expect(g.intent).toBe('setPriority');
    expect(g.slots.priority).toBe('A');
    expect(g.matches).toEqual([idOf('周线复盘')]);
    expect(g.confidence).toBe('high');
  });

  it('「优先级降为低」同样要剥干净', () => {
    const g = run('把周线复盘的优先级降为低');
    expect(g.intent).toBe('setPriority');
    expect(g.slots.priority).toBe('C');
    expect(g.matches).toEqual([idOf('周线复盘')]);
  });

  it('裸单字「高/中/低」只在被空格隔开时才剥，不从标题里挖字', () => {
    // 「高中同学聚会」里的"高"是内容，挖掉就变成"中同学聚会"
    const g = parseIntent('加一条 高中同学聚会', { tasks: TASKS, today: TODAY });
    expect(g.intent).toBe('add');
    expect(g.slots.title).toContain('高中');
  });
});

describe('R7-3：日期解析补漏', () => {
  it('「YYYY年M月D日」必须整段吃掉，否则年份被"当年已过算次年"悄悄改写', () => {
    const g = extractDate('2028年3月5日 交年度总结', TODAY);
    expect(g.date).toBe('2028-03-05');
    expect(g.matchedText).toBe('2028年3月5日');
  });

  it('周/星期/礼拜 前面允许量词「个」', () => {
    expect(extractDate('三个星期以后 交论文', TODAY).date).toBe('2026-10-22');
    expect(extractDate('三个礼拜后 交论文', TODAY).date).toBe('2026-10-22');
    expect(extractDate('两个星期内 交论文', TODAY).date).toBe('2026-10-15');
  });

  it('「拖后 N 天」是延期（此前只在 TRIGGERS 里登记，COMMAND_RULES 漏了）', () => {
    expect(detectAction('把周线复盘拖后一周', TODAY, [])).toBe('postpone');
    expect(extractDate('拖后 5 天', TODAY).date).toBe('2026-10-06');
  });

  it('既有口径不回退：两个月内 / 月底 / 下周三', () => {
    expect(extractDate('两个月内 交论文', TODAY).date).toBe('2026-12-01');
    expect(extractDate('月底之前 结清物业', TODAY).date).toBe('2026-10-31');
    expect(extractDate('下周三 开会', TODAY).date).toBe('2026-10-07');
  });
});

describe('R7-4：「提前到」归 setDue，裸「提前」不是命令', () => {
  it('提前到 = 改截止日，但不能回一句"已延期"（方向是反的）', () => {
    expect(detectAction('把周线复盘提前到本周末', TODAY, [])).toBe('setDue');
    expect(detectAction('把周线复盘提早到下周一', TODAY, [])).toBe('setDue');
  });

  it('裸「提前」是修饰语：「提前完成年报」仍是 complete', () => {
    expect(detectAction('提前完成年报', TODAY, [])).toBe('complete');
  });
});

describe('R7-5：改口句按最后一次说法算', () => {
  const mem = { lastTaskId: 'k1', lastCandidates: [] };
  const run7 = (text) => parseIntent(text, { tasks: TASKS, today: TODAY, memory: mem });
  const idOf = (frag) => TASKS.find((t) => t.title.includes(frag)).id;

  it('动词与日期都取改口后的那一段，且必须确认一次再动手', () => {
    const g = run7('把周线复盘延到下周一，哦不，是延到下周二');
    expect(g.intent).toBe('postpone');
    expect(g.matches).toEqual([idOf('周线复盘')]);
    // 关键：日期必须是改口后的下周二(10-06)，不是前半句的下周一(10-05)
    expect(g.slots.dueDate).toBe('2026-10-06');
    expect(g.needsConfirm).toBe(true);
    expect(g.note).toBe('按你最后说的算');
  });

  it('改口换目标：只认最后点名的那一条', () => {
    const g = run7('删掉季报复核，不是，是删掉周线复盘');
    expect(g.intent).toBe('delete');
    expect(g.matches).toEqual([idOf('周线复盘')]);
    expect(g.needsConfirm).toBe(true);
  });

  it('句中的「不是」是内容不是改口，不许把正常新增拆坏', () => {
    const g = parseIntent('记一下 报销单不是今天的', { tasks: TASKS, today: TODAY });
    // 要点是"没走进改口分支"：intent 仍是 add，标题保留句中的"不是"。
    // 今天/的被 stripNoise 当时间与语气词剥掉，属既有行为，不在本条断言范围内。
    expect(g.intent).toBe('add');
    expect(g.slots.title).toContain('报销单');
    expect(g.slots.title).toContain('不是');
  });
});

describe('R7-6：长尾动词补漏（TRIGGERS 与 COMMAND_RULES 曾漂移）', () => {
  it('还掉 / 还完 算完成', () => {
    expect(detectAction('信用卡账单还掉了', TODAY, [])).toBe('complete');
    expect(detectAction('房贷还完了', TODAY, [])).toBe('complete');
  });

  it('不用留着了 / 扔掉 / 删干净 算删除', () => {
    expect(detectAction('旧手机不用留着了', TODAY, [])).toBe('delete');
    expect(detectAction('把旧手机扔掉', TODAY, [])).toBe('delete');
    expect(detectAction('把这条删干净', TODAY, [])).toBe('delete');
  });

  it('做完 / 拖一拖 补上', () => {
    expect(detectAction('年报做完了', TODAY, [])).toBe('complete');
    expect(detectAction('周线复盘拖一拖', TODAY, [])).toBe('postpone');
  });

  it('记下 / 设个提醒 / 加个提醒 算新增', () => {
    expect(detectAction('记下 明天交周报', TODAY, [])).toBe('add');
    expect(detectAction('帮我设个提醒 明天交周报', TODAY, [])).toBe('add');
  });

  it('「加个提醒」的标题里不该剩下一个"提醒"', () => {
    const g = parseIntent('加个提醒 明天交周报', { tasks: TASKS, today: TODAY });
    expect(g.intent).toBe('add');
    expect(g.slots.title).not.toContain('提醒');
    expect(g.slots.title).toContain('交周报');
  });
});

// —— 第八轮补漏：结构式识别 + 它的反向断言 ——
// 这一批规则的共同特征是"认结构而不是认词"，收益一整族，风险也是一整族。
// 所以每一组都必须带一条**反向**断言：认成命令很容易，证明它没被误升成命令才是关键。
// 判据统一按本项目的硬取向：宁可走澄清，不许静默改文件。
describe('结果补语结构（V+完/好/掉/妥，句尾）', () => {
  it('动词不在词表里也算完成 —— 认结构就不必枚举动词', () => {
    expect(detectAction('三季度发票我核完了', TODAY, [])).toBe('complete');
    expect(detectAction('需求文档我码完了', TODAY, [])).toBe('complete');
    expect(detectAction('车位费我付掉了', TODAY, [])).toBe('complete');
  });

  it('补语必须剥干净，否则关键词带着动词就锁不到任务', () => {
    const g = run('季报复核核完');
    expect(g.intent).toBe('complete');
    expect(g.target.value).not.toContain('核完');
    expect(g.matches).toHaveLength(1);
  });

  it('标题自带的「逾期」前缀会把整句读成查询 —— 只读误判，不是静默改文件', () => {
    // 「逾期任务：季报复核」本身就是一条任务的标题。查询词命中在动作词之前，
    // 于是这句被读成"把逾期的列给我看"。代价是多问一轮，而不是勾错任务，
    // 所以留作已知上限；收窄查询判定会回头砸掉前七轮的「逾期了有哪些」。
    const g = run('逾期任务：季报复核我核完了');
    expect(g.intent).toBe('query');
  });

  it('「干掉 / 扔掉 / 去掉」仍是 delete —— 同位置由词表规则先裁决', () => {
    // 结构式补语排在 COMMAND_RULES 末尾，就是为了在这一格上输给 delete。
    expect(detectAction('把 收 集箱任务 干掉', TODAY, [])).toBe('delete');
    expect(detectAction('把回测的垃圾清掉', TODAY, [])).toBe('delete');
  });

  it('程度词 + 好 不许读成完成命令', () => {
    for (const t of ['这个方案很好', '思路挺好', '时机太成熟不好', '优先级更高好', '成本最低好']) {
      const g = run(t);
      const silent = g.confidence === 'high' && !g.needsConfirm && !g.refused;
      expect(silent, `${t} 不该被当成可直接执行的命令`).toBe(false);
    }
  });

  it('不在句尾的补语不算命令：「看完电影再买爆米花」', () => {
    expect(detectAction('看完电影再买爆米花', TODAY, [])).not.toBe('complete');
  });
});

describe('极性护栏：未 V / 没 V', () => {
  it('「X 未完成」是陈述没做，不是叫我勾掉', () => {
    const g = run('需求文档未完成');
    expect(g.intent).toBe('unknown');
    expect(g.refused).toBe('unrealized');
  });

  it('定语位置的"没"管不住句末动词：「把没用的那条删了」仍是 delete', () => {
    expect(detectAction('把没用的那条删了', TODAY, [])).toBe('delete');
  });

  it('「不用X了」本身是删除命令，不许被当成对后文动词的否定', () => {
    const g = run('普通任务不用做了');
    expect(g.intent).toBe('delete');
    expect(g.refused).toBeFalsy();
  });

  it('但「不要完成X」仍然是否定 —— 框式补语要求"了"紧跟在 1~3 字内', () => {
    const g = run('不要完成 回测报告');
    expect(g.intent).toBe('unknown');
    expect(g.refused).toBe('negated');
  });

  // 框式 delete 与"别做"共用同一个字面，靠"了"后面剩什么来分家。
  // 这一组的价值全在反向那两条：它们都是**极性反转**，做错会直接删掉用户的任务。
  it('框落在句尾 → "这件事不再需要了" → delete', () => {
    expect(run('普通任务不用做了').intent).toBe('delete');
    expect(run('普通任务不用换了').intent).toBe('delete');
    expect(run('普通任务不要了').intent).toBe('delete');
  });

  it('框后只剩宾语 → "了"属于框里的动词，是否定 → 拒答', () => {
    for (const t of ['不要删了普通任务', '不用删了这条', '不要勾了这条', '不要删了，这条']) {
      const g = run(t);
      expect(g.intent, `${t} 不许当成命令执行`).toBe('unknown');
      expect(g.refused, `${t} 必须说明没动手`).toBe('negated');
    }
  });

  it('框后另起一句（有自己的动作词）→ 两件事都成立，不被护栏掐死', () => {
    expect(run('普通任务不用换了季报复核核完').intent).toBe('multi');
  });

  it('「不需要 + 动词」也是否定 —— 上一版否定词表里没有"不需要"这一档', () => {
    const g = run('不需要完成回测报告');
    expect(g.intent).toBe('unknown');
    expect(g.refused).toBe('negated');
    expect(run('普通任务不需要了').intent).toBe('delete');
  });
});

describe('裸序号与并列序号', () => {
  it('汉字序数归一后走序号通道：「第一个」= 列表第 1 条', () => {
    const g = run('第一个删掉');
    expect(g.intent).toBe('delete');
    expect(g.target).toEqual({ kind: 'index', value: 1 });
  });

  it('裸「第一」不带量词不当序号 —— 标题里"第一季"这类写法太常见', () => {
    const g = run('第一 收集箱');
    expect(g.target?.kind).not.toBe('index');
  });

  it('两个并列序号 → multi 只列清单，不许挑一条执行', () => {
    const g = run('把第一个和第三个都完成');
    expect(g.intent).toBe('multi');
    expect(g.slots.items).toHaveLength(2);
    expect(g.matches).toEqual([]);
  });

  it('只有一个序号时不硬凑成 multi', () => {
    expect(run('第一个删掉').intent).not.toBe('multi');
  });
});

describe('农历节日窄年份表', () => {
  it('表内年份给出真实日期', () => {
    expect(extractDate('中秋前给家里买月饼', '2026-12-09').date).toBe('2027-09-14');
    expect(extractDate('春节前 大扫除', '2026-12-09').date).toBe('2027-02-05');
    expect(extractDate('端午 给爸妈买粽子', '2026-12-09').date).toBe('2027-06-09');
  });

  it('表外年份一律不猜 —— 编一个日子比不落更伤', () => {
    for (const t of ['2029-06-01', '2031-01-05']) {
      expect(extractDate('中秋前买月饼', t).date, `${t} 不在表内`).toBeNull();
      expect(extractDate('春节前大扫除', t).date, `${t} 不在表内`).toBeNull();
    }
  });
});

describe('裸连写切分（反向验证）', () => {
  it('两截各自都能锁定真实任务时才拆', () => {
    const g = run('普通任务没有任何标签核完收集箱任务不用了');
    expect(g.intent).toBe('multi');
    expect(g.slots.items.map((i) => i.intent).sort()).toEqual(['complete', 'delete']);
  });

  it('列表里没有对应任务时不许硬拆成两张清单', () => {
    const g = run('把伞收了把鞋换了');
    expect(g.intent).not.toBe('multi');
    expect(g.confidence === 'high' && !g.needsConfirm).toBe(false);
  });

  it('一句里说两遍同一件事不拆', () => {
    const g = run('回测报告要紧 回测报告顶格');
    expect(g.intent).not.toBe('multi');
  });
});
