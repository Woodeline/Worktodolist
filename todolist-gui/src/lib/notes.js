// 备注：外置在数据目录的 `notes.md`，**不动 todo.txt 的「一行一条」**。
//
// 为什么不塞进 todo.txt：
//   · 备注是多行、长、带格式的。todo.txt 的每一行都是一条待办，扫列表、grep、
//     topydo、拖拽排序全依赖这个形状，往里塞多行会一次性打破它们。
//   · 备注不是「扫列表时要看见」的东西，它是点进去才看的。放在列表行里只会挤压标题。
//
// 为什么是**一个文件**而不是 notes/<id>.md 一任务一文件：
//   · 将来要纳入备份 / git，是「多一个路径」而不是「多一个目录」——后者的清理、
//     孤儿回收、目录创建都要另写一套。
//   · 数据目录里不该长出几百个碎文件（那正是 todo.txt 想避免的样子）。
//
// 文件形状：开头一段随便写的说明（原样保留，不会被重写），之后每条备注是
//   `## <stableId>` + 空行 + 正文，直到下一个 `## `。
// id 与 todo.txt 里的 `id:` 标签对应 —— 这就是备注能挂住任务的全部依靠。
import { isValidStableId } from './todoParser';

export const NOTES_FILE = 'notes.md';

const DEFAULT_HEADER = [
  '# 备注',
  '',
  '每条备注以 `## <id>` 起头，id 与 todo.txt 里的 `id:` 标签对应。',
  '正文随便写，Markdown 可用。这一行以上的说明可以改，不会被程序重写。',
  '',
].join('\n');

const SECTION_RE = /^##\s+(\S+)\s*$/;

/**
 * 解析 notes.md。
 * @returns {Map<string,string>} stableId → 正文（已去掉首尾空行）
 */
export function parseNotes(text) {
  const notes = new Map();
  if (typeof text !== 'string' || !text.trim()) return notes;
  const lines = text.split('\n');
  let current = null;
  let buf = [];
  const flush = () => {
    if (current) notes.set(current, buf.join('\n').replace(/\s+$/, ''));
    buf = [];
  };
  for (const line of lines) {
    const m = SECTION_RE.exec(line);
    if (m && isValidStableId(m[1])) {
      flush();
      current = m[1];
      // 跳过标题后的连续空行，让正文从第一个非空行开始
      buf = [];
      continue;
    }
    if (current) {
      // 正文开头的一串空行不收进去（否则每次往返都会多一个空行）
      if (buf.length === 0 && !line.trim()) continue;
      buf.push(line);
    }
  }
  flush();
  return notes;
}

/**
 * 写回 notes.md 全文。
 * @param {Map<string,string>|object} notes id → 正文；空正文的条目会被**整节删掉**
 * @param {string} [existing] 当前文件内容，用来保留用户自己写的说明头
 */
export function serializeNotes(notes, existing) {
  const entries = [];
  if (notes instanceof Map) {
    for (const [id, body] of notes) entries.push([id, body]);
  } else if (notes && typeof notes === 'object') {
    for (const [id, body] of Object.entries(notes)) entries.push([id, body]);
  }
  // 只保留 id 合法、正文非空的条目 —— 空正文等于"这条备注删掉了"，
  // 留一个空节会让文件越用越长，也让「有没有备注」的判断失真。
  const live = entries.filter(([id, body]) => isValidStableId(id) && String(body || '').trim());
  if (live.length === 0) return '';
  // 说明头：用现有文件里第一条备注之前的原文；没有就用默认的那段。
  const header = headerOf(existing) || DEFAULT_HEADER;
  const chunks = live.map(
    ([id, body]) => `## ${id}\n\n${String(body).replace(/\s+$/, '')}\n`
  );
  return `${header}${chunks.join('\n')}`;
}

// 取现有文件里第一条 `## <id>` 之前的全部内容（含结尾空行），原样保留。
function headerOf(existing) {
  if (typeof existing !== 'string' || !existing.trim()) return '';
  const lines = existing.split('\n');
  const out = [];
  for (const line of lines) {
    const m = SECTION_RE.exec(line);
    if (m && isValidStableId(m[1])) break;
    out.push(line);
  }
  if (out.length === 0) return '';
  let text = out.join('\n').replace(/\s+$/, '');
  if (!text.trim()) return '';
  return `${text}\n\n`;
}

/**
 * 读·改·写 的纯函数部分：在既有文本上改一条备注，返回新的全文。
 *
 * 保存必须走这条路（而不是拿内存里的旧文本直接覆盖）：用户可能正用别的编辑器
 * 改着 notes.md，整文件覆盖会把他的改动吃掉。一次「读最新 → 合并 → 写回」只碰
 * 自己那一条，别人的改动跟着留下。
 */
export function writeNote(existing, id, body) {
  if (!isValidStableId(id)) return existing || '';
  const notes = parseNotes(existing);
  const trimmed = String(body || '').replace(/\s+$/, '');
  if (!trimmed.trim()) notes.delete(id);
  else notes.set(id, trimmed);
  return serializeNotes(notes, existing);
}

/** 取某条任务的备注正文（没有则空串）。 */
export function readNote(existing, id) {
  if (!isValidStableId(id)) return '';
  return parseNotes(existing).get(id) || '';
}
