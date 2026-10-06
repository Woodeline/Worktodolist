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

