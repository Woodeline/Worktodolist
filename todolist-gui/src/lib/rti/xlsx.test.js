// 极简 xlsx 读写的单测。
//
// 这套代码是"看不见的地基"：它错了，用户不会看到报错，只会看到导出的文件在
// Excel 里打不开、或导入后数据少了几格。所以两头都钉住：
//   · 写出去的东西能被我们自己的读侧原样读回（含中文、空单元格、特殊字符）；
//   · inflate 与 ZIP 读侧拿 node:zlib 造出来的**压缩**数据对拍 —— 本机测试里
//     用的是 Node 的 deflate，而用户手里在 Excel 另存过的文件正是这条路径。
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildXlsx, inflateRaw, readXlsx } from './xlsx.js';

const u8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const str = (bytes) => Buffer.from(bytes).toString('utf8');

/* ---------------------------------------------------------------------------
   测试用的 ZIP 打包器 —— 特意**另写一份**（生产代码用 store，这里支持 deflate），
   读侧因此是拿"另一个生产者"的文件在验证，而不是自己写的自己读。
   ------------------------------------------------------------------------- */

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [[name, string]] → ZIP 字节（method 8 = deflate） */
function zipDeflated(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (b) => {
    chunks.push(Buffer.from(b));
    offset += b.length;
  };

  files.forEach(([name, content]) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const def = deflateRawSync(raw);
    const sum = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(sum, 14);
    head.writeUInt32LE(def.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const at = offset;
    push(head);
    push(nameBuf);
    push(def);
    central.push({ nameBuf, sum, csize: def.length, usize: raw.length, at });
  });

  const cdStart = offset;
  central.forEach((e) => {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(8, 10);
    h.writeUInt32LE(e.sum, 16);
    h.writeUInt32LE(e.csize, 20);
    h.writeUInt32LE(e.usize, 24);
    h.writeUInt16LE(e.nameBuf.length, 28);
    h.writeUInt32LE(e.at, 42);
    push(h);
    push(e.nameBuf);
  });
  const cdSize = offset - cdStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  push(end);
  return new Uint8Array(Buffer.concat(chunks));
}

/* ---------------------------------------------------------------------------
   inflate
   ------------------------------------------------------------------------- */

describe('inflateRaw（deflate 解压）', () => {
  const texts = ['', 'a', 'hello world', 'x'.repeat(70000), '中文 / emoji 🎉 / <xml> & "引号"'];

  it('与 node:zlib 的 deflateRaw 对拍（默认压缩）', () => {
    texts.forEach((t) => {
      const packed = new Uint8Array(deflateRawSync(Buffer.from(t, 'utf8')));
      expect(str(inflateRaw(packed))).toBe(t);
    });
  });

  it('level 0（stored 块）与 level 9 也能解', () => {
    const big = 'RTI · '.repeat(500) + 't₅₀';
    [0, 1, 9].forEach((level) => {
      const packed = new Uint8Array(deflateRawSync(Buffer.from(big, 'utf8'), { level }));
      expect(str(inflateRaw(packed))).toBe(big);
    });
  });

  it('超过 32KB 的多块数据（回溯距离跨越块边界）', () => {
    const big = Array.from({ length: 200 }, (_, i) => `row-${i}-示例材料-${(i * 37) % 101}`).join('\n');
    const packed = new Uint8Array(deflateRawSync(Buffer.from(big, 'utf8')));
    expect(str(inflateRaw(packed))).toBe(big);
  });

  it('坏数据抛错而不是静默返回半截', () => {
    expect(() => inflateRaw(new Uint8Array([0x03, 0xff]))).toThrow();
  });
});

/* ---------------------------------------------------------------------------
   写 → 读
   ------------------------------------------------------------------------- */

describe('buildXlsx / readXlsx 往返', () => {
  it('中文表名 + 文本/数字/空单元格原样回来', () => {
    const sheets = [
      {
        name: '耐热指数',
        rows: [
          ['材料名称', '示例材料'],
          ['初始特性值 P0', 100],
          [],
          ['老化温度 T（°C）', '老化时长 t（h）', '特性值'],
          [185, 24, 88.4],
          [185, '', 78.3],
          [170, 48, 92],
        ],
      },
      { name: '多材料对比', rows: [['材料名称', '老化温度 T（°C）', 't50（h）'], ['材料 A（PA66）', 160, 1500]] },
    ];
    const back = readXlsx(buildXlsx(sheets));
    expect(back.map((s) => s.name)).toEqual(['耐热指数', '多材料对比']);
    expect(back[0].rows[0]).toEqual(['材料名称', '示例材料']);
    expect(back[0].rows[1]).toEqual(['初始特性值 P0', 100]);
    expect(back[0].rows[4]).toEqual([185, 24, 88.4]);
    expect(back[0].rows[5][1]).toBe(''); // 空单元格读回空串，而不是 undefined
    expect(back[1].rows[1]).toEqual(['材料 A（PA66）', 160, 1500]);
  });

  it('XML 特殊字符与引号不被转义坏掉', () => {
    const tricky = '<a> & "b" \'c\' 🎉 中文';
    const back = readXlsx(buildXlsx([{ name: '表<1>', rows: [[tricky, 1]] }]));
    expect(back[0].rows[0][0]).toBe(tricky);
  });

  it('表名超长/含非法字符/重名时自动收敛（Excel 会拒绝非法表名）', () => {
    const long = '超长的表名' + '很'.repeat(40);
    const back = readXlsx(
      buildXlsx([
        { name: long, rows: [[1]] },
        { name: 'a/b:c', rows: [[2]] },
        { name: 'a/b:c', rows: [[3]] },
        { name: '', rows: [[4]] },
      ])
    );
    const names = back.map((s) => s.name);
    expect(names.every((n) => n.length <= 31)).toBe(true);
    expect(names.some((n) => /[[\]:*?/\\]/.test(n))).toBe(false);
    expect(new Set(names).size).toBe(names.length); // 无重名
  });

  it('没有工作表时报错', () => {
    expect(() => buildXlsx([])).toThrow();
  });
});

/* ---------------------------------------------------------------------------
   读 Excel（另一个生产者写的：deflate 压缩 + sharedStrings）
   ------------------------------------------------------------------------- */

describe('readXlsx 读"别人做的" xlsx', () => {
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const workbook =
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    `<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels =
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  const shared =
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">` +
    `<si><t>材料名称</t></si><si><r><t>材料</t></r><r><t> B</t></r></si></sst>`;

  const sheet =
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2"><v>160</v></c><c r="B2"><v>1500.5</v></c><c r="C2" t="inlineStr"><is><t>甲</t></is></c></row>` +
    `<row r="3"><c r="B3"/><c r="C3" t="str"><v>说明</v></c></row>` +
    `</sheetData></worksheet>`;

  it('deflate + 共享字符串 + 富文本 + 稀疏单元格', () => {
    const bytes = zipDeflated([
      ['[Content_Types].xml', contentTypes],
      ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', workbook],
      ['xl/_rels/workbook.xml.rels', wbRels],
      ['xl/sharedStrings.xml', shared],
      ['xl/worksheets/sheet1.xml', sheet],
    ]);
    const back = readXlsx(bytes);
    expect(back).toHaveLength(1);
    expect(back[0].rows[0]).toEqual(['材料名称', '材料 B']);
    expect(back[0].rows[1]).toEqual([160, 1500.5, '甲']);
    expect(back[0].rows[2][0]).toBe(''); // 完全没出现的 A3
    expect(back[0].rows[2][2]).toBe('说明'); // t="str" 的公式结果
  });

  it('不是 ZIP 就报错（拿 JSON 当 xlsx 喂进来）', () => {
    expect(() => readXlsx(u8('{"rti":{"rows":[]}}'))).toThrow();
  });

  it('ZIP 里没有 workbook.xml 也报错', () => {
    const bytes = zipDeflated([['hello.txt', 'hi']]);
    expect(() => readXlsx(bytes)).toThrow();
  });
});
