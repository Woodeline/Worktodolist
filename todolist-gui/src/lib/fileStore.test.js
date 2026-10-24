// fileStore 浏览器分支的每日备份回归测试（零新增依赖）
// 用手写的目录句柄替身驱动【真实 ensureDailyBackup】，不需要 jsdom。
// 不定义 globalThis.window —— isTauri() 探测 window，缺失即走浏览器分支。
import { describe, expect, it } from 'vitest';
import { ensureDailyBackup } from './fileStore.js';

const DAY = '2026-10-24';

// 最小 File System Access 形状：files 是 name→text 的活字典，
// createWritable 写入直接改字典，entries/removeEntry 面向同一份状态。
function makeFakeDir(files = {}) {
  const dir = {
    async getFileHandle(name, opt) {
      if (!(name in files)) {
        if (opt && opt.create) {
          files[name] = '';
        } else {
          const e = new Error('NotFound');
          e.name = 'NotFoundError';
          throw e;
        }
      }
      const map = files;
      return {
        async getFile() {
          return { async text() { return map[name] ?? ''; } };
        },
        async createWritable() {
          return {
            async write(t) { map[name] = t; },
            async close() {},
          };
        },
      };
    },
    async getDirectoryHandle(name, opt) {
      // backup 子目录的状态挂在父目录字典的 $backup 键上，跟目录实例走 ——
      // 同一目录的多次调用必须看到同一个备份池，否则判重会失真。
      if (name === 'backup') {
        if (!files.$backup) files.$backup = {};
        return makeFakeDir(files.$backup);
      }
      if (!(opt && opt.create)) {
        const e = new Error('NotFound');
        e.name = 'NotFoundError';
        throw e;
      }
      return makeFakeDir({});
    },
    async *entries() {
      for (const [name] of Object.entries(files)) yield [name, { kind: 'file' }];
    },
    async removeEntry(name) { delete files[name]; },
  };
  dir.$files = files;
  return dir;
}

function backupDict(dir) {
  if (!dir.$files.$backup) dir.$files.$backup = {};
  return dir.$files.$backup;
}

function backupNames(dir) {
  return Object.keys(backupDict(dir)).sort();
}

function readBackup(dir, name) {
  return backupDict(dir)[name];
}

describe('ensureDailyBackup（浏览器分支）', () => {
  it('notes.md 存在时，两个家族都备份', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n', 'notes.md': '## 1\n内容\n' });
    const created = await ensureDailyBackup(dir, DAY);
    expect(created).toBe(true);
    expect(readBackup(dir, `todo-${DAY}.txt`)).toBe('任务A\n');
    expect(readBackup(dir, `notes-${DAY}.md`)).toBe('## 1\n内容\n');
  });

  it('notes.md 不存在时只备 todo.txt，不产生空 notes 备份', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n' });
    const created = await ensureDailyBackup(dir, DAY);
    expect(created).toBe(true);
    expect(readBackup(dir, `todo-${DAY}.txt`)).toBe('任务A\n');
    expect(backupNames(dir).filter((n) => n.startsWith('notes-'))).toEqual([]);
  });

  it('notes.md 为空串时同样跳过', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n', 'notes.md': '' });
    await ensureDailyBackup(dir, DAY);
    expect(backupNames(dir).filter((n) => n.startsWith('notes-'))).toEqual([]);
  });

  it('两个家族独立判重：早上备过 todo，中午新建 notes 仍能当天补备', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n' });
    await ensureDailyBackup(dir, DAY);
    // 午间：数据目录里出现了 notes.md（backup 池保持不变）
    const again = makeFakeDir({ 'todo.txt': '任务A\n', 'notes.md': '新备注\n' });
    again.$files.$backup = dir.$files.$backup;
    const created = await ensureDailyBackup(again, DAY);
    expect(created).toBe(true);
    expect(readBackup(dir, `notes-${DAY}.md`)).toBe('新备注\n');
  });

  it('同日第二次调用返回 false，且不覆盖已有备份', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n', 'notes.md': 'N1\n' });
    await ensureDailyBackup(dir, DAY);
    // 之后数据变了，再调一次不该把备份刷成新内容
    const again = makeFakeDir({ 'todo.txt': '任务B\n', 'notes.md': 'N2\n' });
    again.$files.$backup = dir.$files.$backup;
    const created = await ensureDailyBackup(again, DAY);
    expect(created).toBe(false);
    expect(readBackup(dir, `todo-${DAY}.txt`)).toBe('任务A\n');
    expect(readBackup(dir, `notes-${DAY}.md`)).toBe('N1\n');
  });

  it('prune 每个家族独立保留 30 份，且绝不碰非备份文件', async () => {
    const dir = makeFakeDir({ 'todo.txt': 'x\n' });
    for (let i = 1; i <= 31; i += 1) {
      const day = `2026-09-${String(i).padStart(2, '0')}`;
      backupDict(dir)[`todo-${day}.txt`] = 't';
      backupDict(dir)[`notes-${day}.md`] = 'n';
    }
    // 会被误伤风险名单：相似名 / 相邻后缀（这些名字两个家族的正则都不认）
    backupDict(dir)['todo-abcdefgh-1.txt'] = 'not-a-backup';
    backupDict(dir)['notes-2026-09-01.md.bak'] = 'not-a-backup';

    await ensureDailyBackup(dir, DAY);

    const left = backupNames(dir);
    // 计数用与代码同一套家族判定 —— startsWith 会把「风险名单」也数进去
    const isTodo = (n) => /^todo-\d{4}-\d{2}-\d{2}\.txt$/.test(n);
    const isNotes = (n) => /^notes-\d{4}-\d{2}-\d{2}\.md$/.test(n);
    // 31 旧 + 今天新 = 32，prune 到 30：09-01、09-02 被清，各剩 29 旧 + 今天
    expect(left.filter(isTodo)).toHaveLength(30);
    expect(left.filter(isNotes)).toHaveLength(30);
    expect(readBackup(dir, 'todo-2026-09-01.txt')).toBeUndefined();
    expect(readBackup(dir, 'todo-2026-09-02.txt')).toBeUndefined();
    expect(readBackup(dir, 'todo-2026-09-03.txt')).toBe('t');
    expect(readBackup(dir, 'notes-2026-09-03.md')).toBe('n');
    // 风险名单原样
    expect(readBackup(dir, 'todo-abcdefgh-1.txt')).toBe('not-a-backup');
    expect(readBackup(dir, 'notes-2026-09-01.md.bak')).toBe('not-a-backup');
    // 数据文件本体不在 backup 池里，自然无恙
    expect(dir.$files['todo.txt']).toBe('x\n');
  });
});
