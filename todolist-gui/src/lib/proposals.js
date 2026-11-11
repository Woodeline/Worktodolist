// 提议（proposal）—— 工具与对话共用的"先出建议 → 用户确认 → 落盘"模型。
//
// 为什么要有它：批量写 todo.txt 是高危操作，不接受一键直接改文件。工具只能
// 产出**建议**，用户确认之后才走 dispatch（与对话页同一张 ACTIONS 表）。
//
// 提议模型统一为 `{ kind: 'create' | 'edit' | 'batch', items: [...], preview, summary }`：
//   create  新建：只有草稿字段（与对话页的"修改后新建"是同一个模型）
//   edit    改已存在任务的字段（逐条 patch）
//   batch   一次对多条做同一动作（op 见 todoTools/ops.js）
// 目前只有 batch 由工具产出，所以本模块只留 makeBatchProposal；
// create / edit 仍由 proposalToIntent 兜底，字段口径不变。
//
// 一条硬口径：**预览就是最终落盘内容**。两侧共用 todoTools/ops.js 与
// todoParser.serializeTask，不各算一遍。
import { serializeTask } from './todoParser.js';
import { applyOp, opLabel, previewLine } from './todoTools/ops.js';

/** 弹窗里最多摊开多少条明细（其余折叠成"还有 N 条"）。 */
export const PREVIEW_LIMIT = 40;

/**
 * 批量提议（同一个操作作用在多条任务上）。
 * @param {Array<object>} tasks 目标任务（顺序即文件行序，预览按此顺序排）
 * @param {{type:string, value?:*}} op
 * @param {string} today
 */
export function makeBatchProposal(tasks, op, today) {
  const items = [];
  for (const t of tasks || []) {
    if (!t) continue;
    const applied = applyOp(t, op, today);
    if (!applied) continue; // 这条不适用（例如取消星标时本来就没星标）
    items.push({
      id: t.id,
      title: t.title,
      before: t.raw || serializeTask(t),
      after: previewLine(t, op, today), // null = 整行移除
      op: { ...op },
    });
  }
  return {
    kind: 'batch',
    op: { ...op },
    items,
    preview: items.map((i) => ({ title: i.title, before: i.before, after: i.after })),
    summary: `${opLabel(op)} · ${items.length} 条`,
    count: items.length,
  };
}

/** 提议 → 可直接喂给 dispatch 的 intent（不新增旁路：走的还是那张 ACTIONS 表）。 */
export function proposalToIntent(p) {
  if (!p || !p.items || !p.items.length) return null;
  if (p.kind === 'create') {
    const f = p.items[0].fields || {};
    return {
      intent: 'add',
      target: null,
      slots: {
        title: f.title,
        priority: f.priority || undefined,
        dueDate: f.dueDate || undefined,
        contexts: f.contexts || [],
        projects: f.projects || [],
      },
      matches: [],
      nearMatches: [],
      confidence: 'high',
      note: null,
      raw: '',
      needsConfirm: false,
      source: 'tool',
    };
  }
  if (p.kind === 'edit') {
    return {
      intent: 'edit',
      target: null,
      slots: { items: p.items.map((i) => ({ id: i.id, patch: { ...i.patch } })) },
      matches: p.items.map((i) => i.id),
      nearMatches: [],
      confidence: 'high',
      note: null,
      raw: '',
      needsConfirm: false,
      source: 'tool',
    };
  }
  if (p.kind === 'batch') {
    return {
      intent: 'batch',
      target: null,
      slots: { op: { ...p.op } },
      matches: p.items.map((i) => i.id),
      nearMatches: [],
      confidence: 'high',
      note: null,
      raw: '',
      needsConfirm: false,
      source: 'tool',
    };
  }
  return null;
}

