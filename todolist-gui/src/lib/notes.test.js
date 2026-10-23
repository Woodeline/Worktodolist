import { describe, expect, it } from 'vitest';
import {
  NOTES_FILE,
  parseNotes,
  readNote,
  serializeNotes,
  writeNote,
} from './notes';

// 这一组锁的是「一个纯文本文件能不能安全地承载结构化内容」。
// 备注的失效方式主要是**丢数据**：正文被截断、说明头被重写掉、别人的备注被覆盖、
// 或者往返一次多出几个空行。这些都不报错，只在某天打开文件时才发现。

const SAMPLE = [
  '# 备注',
  '',
  '这是我写的说明，程序不该动它。',
  '',
  '## aaa111',
  '',
  '第一条备注',
  '第二行',
  '',
  '## bbb222',
  '',
  '第二条备注',
  '',
].join('\n');

describe('parseNotes', () => {
  it('按 ## <id> 切分，正文保留换行', () => {
    const notes = parseNotes(SAMPLE);
    expect(notes.get('aaa111')).toBe('第一条备注\n第二行');
    expect(notes.get('bbb222')).toBe('第二条备注');
    expect(notes.size).toBe(2);
  });

  it('标题后的空行不进正文（否则每次往返都多一个空行）', () => {
    expect(parseNotes('## aaa111\n\n\n内容\n').get('aaa111')).toBe('内容');
  });

  it('认不出 id 的 ## 行不算一节，也不炸', () => {
    // 用户可能在文件里写 `## 2026 年计划` 这种标题 —— 它不是备注，忽略即可
    const notes = parseNotes('## 随便写的标题\n正文\n\n## aaa111\n真的备注\n');
    expect(notes.has('aaa111')).toBe(true);
    expect(notes.get('aaa111')).toBe('真的备注');
    expect(notes.size).toBe(1);
  });

  it('空文件 / 空串 / 非字符串 → 空 Map', () => {
    expect(parseNotes('').size).toBe(0);
    expect(parseNotes(null).size).toBe(0);
  });

  it('重复的 id 只认最后一节（后写的覆盖先写的，与"最后一次编辑胜出"一致）', () => {
    expect(parseNotes('## aaa111\n旧\n\n## aaa111\n新\n').get('aaa111')).toBe('新');
  });
});

describe('serializeNotes', () => {
  it('往返不丢正文：解析 → 序列化 → 再解析内容一致', () => {
    const once = parseNotes(SAMPLE);
    const twice = parseNotes(serializeNotes(once, SAMPLE));
    expect(twice.get('aaa111')).toBe('第一条备注\n第二行');
    expect(twice.get('bbb222')).toBe('第二条备注');
    expect(twice.size).toBe(2);
  });

  it('用户写的说明头原样保留', () => {
    const text = serializeNotes(parseNotes(SAMPLE), SAMPLE);
    expect(text).toContain('这是我写的说明，程序不该动它。');
  });

  it('没有既有文件时给一段默认说明（告诉人这个文件是什么）', () => {
    const text = serializeNotes(new Map([['aaa111', '内容']]), '');
    expect(text.startsWith('# 备注')).toBe(true);
    expect(text).toContain('## aaa111');
  });

  it('空正文的条目不落盘（写空 = 删掉这条备注）', () => {
    const notes = new Map([
      ['aaa111', '有内容'],
      ['bbb222', '   '],
    ]);
    expect(serializeNotes(notes, '')).not.toContain('bbb222');
  });

  it('一条备注都没有时返回空串 —— 不写一个只有说明头的空文件', () => {
    expect(serializeNotes(new Map(), SAMPLE)).toBe('');
  });

  it('id 非法的条目不落盘（它挂不住任何任务）', () => {
    expect(serializeNotes(new Map([['!!!', '内容']]), '')).toBe('');
  });
});

describe('writeNote', () => {
  it('改一条，别的不动（这是"不覆盖别人改动"的核心）', () => {
    const next = writeNote(SAMPLE, 'aaa111', '改过了');
    const notes = parseNotes(next);
    expect(notes.get('aaa111')).toBe('改过了');
    expect(notes.get('bbb222')).toBe('第二条备注');
  });

  it('新增一条，既有内容仍在', () => {
    const next = writeNote(SAMPLE, 'ccc333', '新备注');
    expect(parseNotes(next).get('ccc333')).toBe('新备注');
    expect(parseNotes(next).get('aaa111')).toBe('第一条备注\n第二行');
  });

  it('写成空 = 删掉那一节，且不留空节', () => {
    const next = writeNote(SAMPLE, 'aaa111', '');
    expect(next).not.toContain('aaa111');
    expect(parseNotes(next).get('bbb222')).toBe('第二条备注');
  });

  it('id 非法时原样返回（不改文件，也不静默建一个挂不住的节）', () => {
    expect(writeNote(SAMPLE, '!!', 'x')).toBe(SAMPLE);
  });

  it('反复写同一条不会产生重复节', () => {
    let text = SAMPLE;
    for (let i = 0; i < 5; i += 1) text = writeNote(text, 'aaa111', `第 ${i} 次`);
    expect(parseNotes(text).get('aaa111')).toBe('第 4 次');
    expect(text.match(/^## aaa111$/gm)).toHaveLength(1);
  });

  it('正文里的 ## 不会被当成新的节（只在行首且独占一行才算）', () => {
    const next = writeNote(SAMPLE, 'aaa111', '标题 ## 不是节\n正文');
    expect(parseNotes(next).get('aaa111')).toBe('标题 ## 不是节\n正文');
  });
});

describe('readNote', () => {
  it('取得到与取不到', () => {
    expect(readNote(SAMPLE, 'aaa111')).toBe('第一条备注\n第二行');
    expect(readNote(SAMPLE, 'zzz999')).toBe('');
    expect(readNote(SAMPLE, null)).toBe('');
  });
});

describe('NOTES_FILE', () => {
  it('是数据目录里的 notes.md（与 todo.txt 同级，不带子目录）', () => {
    expect(NOTES_FILE).toBe('notes.md');
    expect(NOTES_FILE).not.toContain('/');
  });
});
