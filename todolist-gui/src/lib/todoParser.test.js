import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  completeTask,
  isValidDate,
  parseFile,
  parseQuickInput,
  parseSingleLine,
  reviveTask,
  serializeEntries,
  serializeTask,
  taskFromQuickInput,
} from './todoParser';

// 用户真实数据集（开发期测试数据）
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

const DONE_FIXTURE = [
  'x 2026-09-28 2026-09-27 (A) 已完成的示例：安装 topydo 并跑通三种 UI',
  'x 2026-09-29 2026-09-28 (B) 已完成的示例：编写安装配置指南 @文档',
].join('\n');

const SEMANTIC_FIELDS = [
  'kind',
  'completed',
  'completedAt',
  'createdAt',
  'priority',
  'title',
  'contexts',
  'projects',
  'dueDate',
  'thresholdDate',
  'starValue',
  'extraTags',
];

function semantic(task) {
  const out = {};
  for (const key of SEMANTIC_FIELDS) out[key] = task[key];
  return out;
}

describe('parseSingleLine - 完成行', () => {
  it('解析完成行（无创建日期）', () => {
    const t = parseSingleLine('x 2026-09-30 2026-09-20 买牛奶');
    expect(t.kind).toBe('task');
    expect(t.completed).toBe(true);
    expect(t.completedAt).toBe('2026-09-30');
    expect(t.createdAt).toBe('2026-09-20');
    expect(t.title).toBe('买牛奶');
  });

  it('解析完成行（仅完成日期）', () => {
    const t = parseSingleLine('x 2026-09-30 买牛奶');
    expect(t.completed).toBe(true);
    expect(t.completedAt).toBe('2026-09-30');
    expect(t.createdAt).toBeNull();
    expect(t.title).toBe('买牛奶');
  });

  it('完成行优先级位于两个日期之后', () => {
    const t = parseSingleLine('x 2026-09-28 2026-09-27 (A) 标题');
    expect(t.completed).toBe(true);
    expect(t.completedAt).toBe('2026-09-28');
    expect(t.createdAt).toBe('2026-09-27');
    expect(t.priority).toBe('A');
    expect(t.title).toBe('标题');
  });
});

describe('parseSingleLine - 活跃行', () => {
  it('优先级 + 创建日期 + due', () => {
    const t = parseSingleLine('(B) 2026-09-30 写周报 due:2026-10-05');
    expect(t.completed).toBe(false);
    expect(t.priority).toBe('B');
    expect(t.createdAt).toBe('2026-09-30');
    expect(t.dueDate).toBe('2026-10-05');
    expect(t.title).toBe('写周报');
  });

  it('多 @分类 / 多 +项目', () => {
    const t = parseSingleLine('2026-09-30 任务 @工作 @生活 +项目A +项目B');
    expect(t.contexts).toEqual(['工作', '生活']);
    expect(t.projects).toEqual(['项目A', '项目B']);
    expect(t.title).toBe('任务');
  });

  it('t: 阈值、star:1', () => {
    const t = parseSingleLine('(D) 2026-09-20 星标任务 star:1 t:2026-10-05');
    expect(t.starValue).toBe('1');
    expect(t.thresholdDate).toBe('2026-10-05');
    expect(t.priority).toBe('D');
  });

  it('额外 key:value 透传且不丢失（effort:2h）', () => {
    const t = parseSingleLine('2026-09-20 调研 effort:2h owner:alex');
    expect(t.extraTags).toEqual([
      { key: 'effort', value: '2h' },
      { key: 'owner', value: 'alex' },
    ]);
    expect(t.title).toBe('调研');
    expect(serializeTask(t)).toContain('effort:2h');
    expect(serializeTask(t)).toContain('owner:alex');
  });

  it('D~F 优先级透传', () => {
    for (const p of ['D', 'E', 'F']) {
      const t = parseSingleLine(`(${p}) 2026-09-20 普通任务`);
      expect(t.priority).toBe(p);
    }
  });
});

describe('非法输入与鲁棒性', () => {
  it('空行与 # 注释行', () => {
    const entries = parseFile('\n# 这是注释\n\n(A) 2026-09-20 真任务\n');
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('comment');
    expect(entries[0].raw).toBe('# 这是注释');
    expect(entries[1].kind).toBe('task');
    expect(entries[1].title).toBe('真任务');
  });

  it('非法日期不被接受为合法日期', () => {
    expect(isValidDate('2026-13-45')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-10-05')).toBe(true);
    const t = parseSingleLine('2026-13-45 任务');
    expect(t.createdAt).toBeNull();
    expect(t.title).toBe('任务');
  });

  it('非法 due 值保留为字符串但不合法', () => {
    const t = parseSingleLine('(A) 2026-09-20 任务 due:2026-13-45');
    expect(t.dueDate).toBe('2026-13-45');
    expect(isValidDate(t.dueDate)).toBe(false);
  });

  it('时间片段 13:45 不误判为标签', () => {
    const t = parseSingleLine('2026-09-20 会议 13:45');
    expect(t.title).toBe('会议 13:45');
    expect(t.extraTags).toHaveLength(0);
  });

  it('无标题行（只有 @工作）→ kind:raw', () => {
    const t = parseSingleLine('@工作');
    expect(t.kind).toBe('raw');
    expect(t.raw).toBe('@工作');
  });

  it('仅 x → kind:raw', () => {
    expect(parseSingleLine('x').kind).toBe('raw');
  });

  it('仅有 (A)（无尾随空格）按 topydo 视为普通标题', () => {
    const t = parseSingleLine('(A)');
    expect(t.kind).toBe('task');
    expect(t.priority).toBeNull();
    expect(t.title).toBe('(A)');
  });

  it('"x ray" 视为完成行（对齐 topydo）', () => {
    const t = parseSingleLine('x ray machine');
    expect(t.completed).toBe(true);
    expect(t.title).toBe('ray machine');
  });
});

describe('真实数据集', () => {
  it('9 条活跃任务字段正确', () => {
    const entries = parseFile(TODO_FIXTURE);
    const tasks = entries.filter((e) => e.kind === 'task');
    expect(tasks).toHaveLength(9);

    expect(tasks[0]).toMatchObject({
      priority: 'A',
      createdAt: '2026-09-20',
      title: '逾期任务：季报复核',
      dueDate: '2026-09-25',
    });
    expect(tasks[2]).toMatchObject({ priority: 'C', projects: ['回测'], dueDate: '2026-10-10' });
    expect(tasks[3]).toMatchObject({ priority: 'D', starValue: '1' });
    expect(tasks[4]).toMatchObject({ priority: 'E', thresholdDate: '2026-10-05' });
    expect(tasks[6]).toMatchObject({
      priority: null,
      contexts: ['工作'],
      projects: ['量化'],
      dueDate: '2026-10-08',
    });
    expect(tasks[7]).toMatchObject({
      priority: null,
      contexts: [],
      projects: [],
      title: '收集箱任务：无任何标记的裸任务',
    });
    expect(tasks[8]).toMatchObject({ priority: 'B', contexts: ['投资'], projects: ['复盘'] });
  });

  it('2 条已完成任务字段正确', () => {
    const entries = parseFile(DONE_FIXTURE);
    const tasks = entries.filter((e) => e.kind === 'task');
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      completed: true,
      completedAt: '2026-09-28',
      createdAt: '2026-09-27',
      priority: 'A',
      title: '已完成的示例：安装 topydo 并跑通三种 UI',
    });
    expect(tasks[1]).toMatchObject({
      completed: true,
      completedAt: '2026-09-29',
      priority: 'B',
      contexts: ['文档'],
    });
  });
});

describe('往返等价 parse → serialize', () => {
  it('活跃数据集逐行语义等价', () => {
    const entries = parseFile(TODO_FIXTURE);
    for (const entry of entries) {
      const reparsed = parseSingleLine(serializeTask(entry));
      expect(semantic(reparsed)).toEqual(semantic(entry));
    }
  });

  it('已完成数据集逐行语义等价', () => {
    const entries = parseFile(DONE_FIXTURE);
    for (const entry of entries) {
      const reparsed = parseSingleLine(serializeTask(entry));
      expect(semantic(reparsed)).toEqual(semantic(entry));
    }
  });

  it('整个文件往返后条目数不变', () => {
    const entries = parseFile(TODO_FIXTURE);
    const text = serializeEntries(entries);
    const round = parseFile(text);
    expect(round.map(semantic)).toEqual(entries.map(semantic));
  });

  it('序列化完成行时优先级位于两个日期之后', () => {
    const t = parseSingleLine('(A) 2026-09-27 交报告');
    const done = completeTask(t, '2026-09-28');
    expect(serializeTask(done)).toBe('x 2026-09-28 2026-09-27 (A) 交报告');
    const revived = reviveTask(done);
    expect(serializeTask(revived)).toBe('(A) 2026-09-27 交报告');
  });

  it('applyPatch 会重算 raw', () => {
    const t = parseSingleLine('(B) 2026-09-30 写周报 due:2026-10-05');
    const patched = applyPatch(t, { priority: 'A', dueDate: '2026-10-01' });
    expect(serializeTask(patched)).toBe('(A) 2026-09-30 写周报 due:2026-10-01');
    expect(patched.raw).toBe(serializeTask(patched));
  });
});

describe('快速添加解析', () => {
  it('parseQuickInput 拆分内联语法', () => {
    const r = parseQuickInput('买牛奶 @超市 due:2026-10-01 (A)');
    expect(r.title).toBe('买牛奶');
    expect(r.contexts).toEqual(['超市']);
    expect(r.dueDate).toBe('2026-10-01');
    expect(r.priority).toBe('A');
  });

  it('优先级可出现在任意位置且小写自动大写', () => {
    const r = parseQuickInput('(a) 开会 +周会');
    expect(r.priority).toBe('A');
    expect(r.projects).toEqual(['周会']);
    expect(r.title).toBe('开会');
  });

  it('taskFromQuickInput 自动补当天创建日期并正确序列化', () => {
    const task = taskFromQuickInput('买牛奶 @超市 due:2026-10-01 (A)', '2026-09-30');
    expect(task.createdAt).toBe('2026-09-30');
    expect(serializeTask(task)).toBe('(A) 2026-09-30 买牛奶 @超市 due:2026-10-01');
  });
});
