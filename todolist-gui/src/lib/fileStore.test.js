// fileStore 浏览器分支的回归测试（零新增依赖）
// 用手写的目录句柄替身驱动【真实 ensureDailyBackup / readFileText / writeFileText】，
// 不需要 jsdom。不定义 globalThis.window —— isTauri() 探测 window，缺失即走浏览器分支。
import { describe, expect, it } from 'vitest';
import { ensureDailyBackup, readFileText, writeFileText } from './fileStore.js';

const DAY = '2026-10-24';

// 最小 File System Access 形状：files 是 name→text 的活字典，
// createWritable **先把内容暂存、close 才提交**（Chromium 的真实行为：
// 写入落在交换文件里，close 时原子覆盖）—— 只有这样才测得到「写到一半失败」
// 这条路径。opts.failOn(name, phase) 返回 true 时该次写入失败（phase = 'write' | 'close'）。
function makeFakeDir(files = {}, opts = {}) {
  const failOn = (name, phase) =>
    typeof opts.failOn === 'function' && Boolean(opts.failOn(name, phase));
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
          const staged = [];
          return {
            async write(t) {
              if (failOn(name, 'write')) throw new Error(`模拟写入失败：${name} (write)`);
              staged.push(t);
            },
            async close() {
              if (failOn(name, 'close')) throw new Error(`模拟写入失败：${name} (close)`);
              map[name] = staged.join('');
            },
            async abort() {},
          };
        },
      };
    },
    async getDirectoryHandle(name, opt) {
      // 运行态目录树：.worktodolist/{backup,sessions,logs}；目录状态挂在父字典的
      // $<name> 键上，跟目录实例走 —— 同一目录的多次调用必须看到同一个池子。
      if (!(name in files)) {
        if (!(opt && opt.create)) {
          const e = new Error('NotFound');
          e.name = 'NotFoundError';
          throw e;
        }
        files[name] = {};
      }
      return makeFakeDir(files[name], opts);
    },
    async *entries() {
      for (const [name, value] of Object.entries(files)) {
        if (typeof value === 'string') yield [name, { kind: 'file' }];
      }
    },
    async removeEntry(name) { delete files[name]; },
  };
  dir.$files = files;
  return dir;
}

function stateDict(dir) {
  if (!dir.$files['.worktodolist']) dir.$files['.worktodolist'] = {};
  return dir.$files['.worktodolist'];
}

function backupDict(dir) {
  const state = stateDict(dir);
  if (!state.backup) state.backup = {};
  return state.backup;
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
    again.$files['.worktodolist'] = dir.$files['.worktodolist'];
    const created = await ensureDailyBackup(again, DAY);
    expect(created).toBe(true);
    expect(readBackup(dir, `notes-${DAY}.md`)).toBe('新备注\n');
  });

  it('同日第二次调用返回 false，且不覆盖已有备份', async () => {
    const dir = makeFakeDir({ 'todo.txt': '任务A\n', 'notes.md': 'N1\n' });
    await ensureDailyBackup(dir, DAY);
    // 之后数据变了，再调一次不该把备份刷成新内容
    const again = makeFakeDir({ 'todo.txt': '任务B\n', 'notes.md': 'N2\n' });
    again.$files['.worktodolist'] = dir.$files['.worktodolist'];
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

// ——— R-14：浏览器分支的 I/O 失败注入 ———
// 这一组是 B1 的验收底座。它们大多在修复前就是绿的 —— **它们是防回归基线，
// 不是新 BUG 的红点**（真正的红点是 useTodoStore.test.js 里的 1.x / 2.x）。
// 之所以必须补上：旧替身是「直写、永远成功、永远原子」，写盘失败这条路径
// 在单测里从未被走到过，于是「失败时目标文件会不会被写坏」根本无从回归。
describe('writeFileText / readFileText（浏览器分支，失败注入）', () => {
  it('14.1 write 阶段失败：目标文件保持原内容', async () => {
    const dir = makeFakeDir({ 'todo.txt': '原内容\n' }, { failOn: (n, phase) => n === 'todo.txt' && phase === 'write' });
    await expect(writeFileText(dir, 'todo.txt', '新内容\n')).rejects.toThrow(/write/);
    expect(dir.$files['todo.txt']).toBe('原内容\n');
  });

  it('14.2 close 阶段失败（Chromium 的真实失败点）：目标文件同样保持原内容', async () => {
    const dir = makeFakeDir({ 'done.txt': '原内容\n' }, { failOn: (n, phase) => n === 'done.txt' && phase === 'close' });
    await expect(writeFileText(dir, 'done.txt', '新内容\n')).rejects.toThrow(/close/);
    // 暂存在交换文件里的内容不会被提交 —— 这就是「写到一半崩了，原文件还是完整的」
    expect(dir.$files['done.txt']).toBe('原内容\n');
  });

  it('14.3 文件不存在（NotFoundError）读成空串 —— 首次启动不该炸', async () => {
    const dir = makeFakeDir({});
    await expect(readFileText(dir, 'todo.txt')).resolves.toBe('');
  });

  it('14.4 非 NotFound 的读错误必须上抛（不许静默当成空文件）', async () => {
    // 权限被拒 / 目录被拔走这类错误如果被吞成 ''，上层会把整份清单当成「空的」，
    // 下一次保存就把磁盘上的数据全抹了 —— 所以这里必须抛。
    const broken = {
      async getFileHandle() {
        const e = new Error('权限不足');
        e.name = 'NotAllowedError';
        throw e;
      },
    };
    await expect(readFileText(broken, 'todo.txt')).rejects.toThrow('权限不足');
  });

  it('14.5 写入是整体替换，不是追加（close 提交的是本次全部暂存内容）', async () => {
    const dir = makeFakeDir({ 'todo.txt': '老的一行\n老的两行\n' });
    await writeFileText(dir, 'todo.txt', '只剩一行\n');
    expect(dir.$files['todo.txt']).toBe('只剩一行\n');
    await writeFileText(dir, 'todo.txt', '');
    expect(dir.$files['todo.txt']).toBe('');
  });

  it('14.6 两个文件各自提交：todo 写失败时 done 已提交的内容仍在（无跨文件事务）', async () => {
    // 浏览器侧没有跨文件事务（Rust 侧也没有）。这条用例的作用是把这件事钉成契约：
    // 「先 done 后 todo + 失败时补偿」必须由上层（useTodoStore）自己做，
    // 不能指望 fileStore 帮它回滚。
    const dir = makeFakeDir(
      { 'todo.txt': 'old todo\n', 'done.txt': 'old done\n' },
      { failOn: (n) => n === 'todo.txt' }
    );
    await writeFileText(dir, 'done.txt', 'new done\n');
    await expect(writeFileText(dir, 'todo.txt', 'new todo\n')).rejects.toThrow();
    expect(dir.$files['done.txt']).toBe('new done\n'); // 已提交，不会自己回滚
    expect(dir.$files['todo.txt']).toBe('old todo\n'); // 目标文件保持原内容
  });
});
