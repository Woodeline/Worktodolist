// 极简 xlsx 读写 —— 不引第三方库（本工具刻意保持零新增依赖）。
//
// .xlsx 就是一只 ZIP，里面装着几个 XML：
//   [Content_Types].xml          —— 声明各部件类型
//   _rels/.rels                  —— 包级关系（指向 workbook）
//   xl/workbook.xml              —— 工作表清单（名字 + r:id）
//   xl/_rels/workbook.xml.rels   —— 工作表 id → worksheets/sheetN.xml
//   xl/worksheets/sheetN.xml     —— 单元格数据
//   xl/sharedStrings.xml         —— 共享字符串表（Excel 自己保存时用；我们导出用 inlineStr）
//
// 于是只需要两件事：写得出一只 ZIP、读得回一只 ZIP。写用 store（不压缩）——
// 数据量是几张表，压缩省下的那点体积不值一套 deflate 编码器；读必须支持 deflate
// （method 8），因为**用户在 Excel 里改过再另存**的文件一定是压缩过的。
//
// 读 deflate 用的是一段自带的 inflate（puff 式：定长/动态 Huffman + stored 块），
// 而不是浏览器的 DecompressionStream：后者在 Node（单测环境）与老 WebView 上
// 不保证存在，而"能不能打开用户手里的 xlsx"这件事不该取决于运行时版本。
//
// 约定：单元格值一律是 string | number | null；null / 空串表示空单元格。
// 不处理公式、样式、日期格式 —— 本工具的表是纯数字与短文本，够用即止。

/* ---------------------------------------------------------------------------
   字节工具
   ------------------------------------------------------------------------- */

const utf8Enc = new TextEncoder();
const utf8Dec = new TextDecoder('utf-8');

/** 可增长的字节缓冲：ZIP 头部要按小端逐字段写，用 DataView 比拼数组清楚 */
class ByteWriter {
  constructor(cap = 1024) {
    this.buf = new Uint8Array(cap);
    this.len = 0;
  }

  _ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u16(v) {
    this._ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }

  u32(v) {
    this._ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 24) & 0xff;
  }

  bytes(u8) {
    this._ensure(u8.length);
    this.buf.set(u8, this.len);
    this.len += u8.length;
  }

  slice() {
    return this.buf.slice(0, this.len);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------------------------
   deflate 解压（inflate）
   ------------------------------------------------------------------------- */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** 码长表 → 规范 Huffman 表（counts / 按码长排好的符号表） */
function buildHuff(lengths) {
  const maxBits = lengths.reduce((m, l) => (l > m ? l : m), 0);
  const counts = new Array(maxBits + 1).fill(0);
  lengths.forEach((l) => {
    if (l) counts[l] += 1;
  });
  const offsets = new Array(maxBits + 2).fill(0);
  for (let i = 1; i <= maxBits; i++) offsets[i + 1] = offsets[i] + counts[i];
  const symbols = new Uint16Array(offsets[maxBits + 1]);
  lengths.forEach((l, s) => {
    if (l) symbols[offsets[l]++] = s;
  });
  return { counts, symbols, maxBits };
}

let FIXED_TABLES = null;

function fixedTables() {
  if (!FIXED_TABLES) {
    const lit = new Array(288);
    for (let i = 0; i < 144; i++) lit[i] = 8;
    for (let i = 144; i < 256; i++) lit[i] = 9;
    for (let i = 256; i < 280; i++) lit[i] = 7;
    for (let i = 280; i < 288; i++) lit[i] = 8;
    FIXED_TABLES = [buildHuff(lit), buildHuff(new Array(30).fill(5))];
  }
  return FIXED_TABLES;
}

/** RFC 1951 raw inflate（无 zlib 头）。坏数据一律抛错，交给调用方转成人话提示。 */
export function inflateRaw(input) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  const out = [];

  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= input.length) throw new Error('压缩数据被截断');
      bitBuf |= input[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };

  const decode = (huff) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= huff.maxBits; len++) {
      code |= bits(1);
      const count = huff.counts[len];
      if (code - count < first) return huff.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Huffman 码无效');
  };

  const block = (litHuff, distHuff) => {
    for (;;) {
      const sym = decode(litHuff);
      if (sym < 256) {
        out.push(sym);
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= LEN_BASE.length) throw new Error('长度码超出范围');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const ds = decode(distHuff);
        const dist = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        if (dist > out.length) throw new Error('回溯距离越界');
        const from = out.length - dist;
        for (let i = 0; i < len; i++) out.push(out[from + i]);
      }
    }
  };

  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      // stored：丢弃当前字节内剩余的位，读 LEN/NLEN
      bitBuf = 0;
      bitCnt = 0;
      const len = input[pos] | (input[pos + 1] << 8);
      pos += 4;
      if (pos + len > input.length) throw new Error('压缩数据被截断');
      for (let i = 0; i < len; i++) out.push(input[pos++]);
    } else if (type === 1) {
      const [lit, dist] = fixedTables();
      block(lit, dist);
    } else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const clLens = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) clLens[CLEN_ORDER[i]] = bits(3);
      const clHuff = buildHuff(clLens);
      const lens = [];
      while (lens.length < hlit + hdist) {
        const sym = decode(clHuff);
        if (sym < 16) {
          lens.push(sym);
        } else if (sym === 16) {
          const n = bits(2) + 3;
          const prev = lens[lens.length - 1] || 0;
          for (let i = 0; i < n; i++) lens.push(prev);
        } else if (sym === 17) {
          const n = bits(3) + 3;
          for (let i = 0; i < n; i++) lens.push(0);
        } else {
          const n = bits(7) + 11;
          for (let i = 0; i < n; i++) lens.push(0);
        }
      }
      block(buildHuff(lens.slice(0, hlit)), buildHuff(lens.slice(hlit)));
    } else {
      throw new Error('deflate 块类型无效');
    }
  } while (!last);

  return Uint8Array.from(out);
}

/* ---------------------------------------------------------------------------
   ZIP 写 / 读（写用 store，读兼容 store 与 deflate）
   ------------------------------------------------------------------------- */

function zipWrite(entries) {
  const w = new ByteWriter(4096);
  const central = [];
  entries.forEach((e) => {
    const name = utf8Enc.encode(e.name);
    const data = e.data;
    const sum = crc32(data);
    const at = w.len;
    w.u32(0x04034b50);
    w.u16(20); // version needed
    w.u16(0x0800); // flag：文件名按 UTF-8 解释
    w.u16(0); // method：store
    w.u16(0); // 时间/日期（本工具不需要稳定的存档时间戳）
    w.u16(0);
    w.u32(sum);
    w.u32(data.length);
    w.u32(data.length);
    w.u16(name.length);
    w.u16(0);
    w.bytes(name);
    w.bytes(data);
    central.push({ name, sum, size: data.length, at });
  });

  const cdStart = w.len;
  central.forEach((e) => {
    w.u32(0x02014b50);
    w.u16(20);
    w.u16(20);
    w.u16(0x0800);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(e.sum);
    w.u32(e.size);
    w.u32(e.size);
    w.u16(e.name.length);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(e.at);
    w.bytes(e.name);
  });
  const cdSize = w.len - cdStart;

  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);
  return w.slice();
}

/** ZIP 字节 → Map<路径, 内容字节>。目录项从尾部 EOCD 反查，与写入端同构。 */
function zipRead(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minStart = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 ZIP 结尾）');

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== 0x02014b50) throw new Error('xlsx 的 ZIP 目录损坏');
    const method = view.getUint16(off + 10, true);
    const csize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localAt = view.getUint32(off + 42, true);
    const name = utf8Dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));

    // 本地头里的名字/额外字段长度可能与目录项不同，必须以本地头为准
    const lNameLen = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataAt, dataAt + csize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRaw(raw));
    else throw new Error(`xlsx 用了不支持的压缩方式（method=${method}）`);

    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------------------------------------------------------------------
   XML 片段
   ------------------------------------------------------------------------- */

function xmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlUnesc(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const n = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

/** 列序号（0 起）→ 列名：0=A, 25=Z, 26=AA */
function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 列名 → 列序号（0 起），A→0；解析不出来就给 0 */
function colIndex(name) {
  let n = 0;
  for (let i = 0; i < name.length; i++) n = n * 26 + (name.charCodeAt(i) - 64);
  return n > 0 ? n - 1 : 0;
}

/* ---------------------------------------------------------------------------
   写：工作表 → xlsx 字节
   ------------------------------------------------------------------------- */

/** Excel 对表名的硬限制：≤31 字符、不能含 []:*?/\；重名在后面加序号 */
function safeSheetName(name, index, used) {
  let base = String(name == null ? '' : name).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || `Sheet${index + 1}`;
  let out = base;
  let k = 2;
  while (used.has(out)) out = `${base.slice(0, 27)}_${k++}`;
  used.add(out);
  return out;
}

function sheetXml(rows) {
  const body = rows
    .map((cells, ri) => {
      const cs = [];
      (cells || []).forEach((v, ci) => {
        if (v == null || v === '') return;
        const ref = `${colName(ci)}${ri + 1}`;
        if (typeof v === 'number' && Number.isFinite(v)) cs.push(`<c r="${ref}"><v>${v}</v></c>`);
        else cs.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`);
      });
      return `<row r="${ri + 1}">${cs.join('')}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * 多工作表 → xlsx 字节。
 * sheets: [{ name, rows }]，rows 是二维数组（string | number | null）。
 * 字符串一律写 inlineStr：不建共享字符串表，导出器就没有第二处状态要维护。
 */
export function buildXlsx(sheets) {
  const used = new Set();
  const list = (sheets || []).map((s, i) => ({ name: safeSheetName(s && s.name, i, used), rows: (s && s.rows) || [] }));
  if (!list.length) throw new Error('至少要有一个工作表');

  const enc = (s) => utf8Enc.encode(s);
  const entries = [];

  entries.push({
    name: '[Content_Types].xml',
    data: enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `</Types>`
    ),
  });

  entries.push({
    name: '_rels/.rels',
    data: enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    ),
  });

  entries.push({
    name: 'xl/workbook.xml',
    data: enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        list.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets></workbook>`
    ),
  });

  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `</Relationships>`
    ),
  });

  list.forEach((s, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) }));

  return zipWrite(entries);
}

/* ---------------------------------------------------------------------------
   读：xlsx 字节 → 工作表
   ------------------------------------------------------------------------- */

/** 共享字符串表：每个 <si> 里的所有 <t> 拼起来（富文本会被拼成一段纯文本） */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let tm;
    while ((tm = tRe.exec(inner))) text += xmlUnesc(tm[1] || '');
    out.push(text);
  }
  return out;
}

function cellValue(type, body, shared) {
  const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
  const raw = vMatch ? xmlUnesc(vMatch[1]) : null;
  if (type === 'inlineStr' || type === 's') {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let tm;
    while ((tm = tRe.exec(body))) text += xmlUnesc(tm[1] || '');
    if (type === 'inlineStr') return text;
    if (text) return text; // 少数写入器把共享字符串也内联塞在 <is> 里
    const i = raw == null ? NaN : Number(raw);
    return Number.isInteger(i) && shared[i] != null ? shared[i] : '';
  }
  if (raw == null) return '';
  if (type === 'str' || type === 'e') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const inner = rm[1] || '';
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(inner))) {
      const attrs = cm[1] != null ? cm[1] : cm[2] || '';
      const body = cm[3] || '';
      const ref = /\br="([A-Za-z]+)\d+"/.exec(attrs);
      const typeM = /\bt="([^"]+)"/.exec(attrs);
      const ci = ref ? colIndex(ref[1].toUpperCase()) : cells.length;
      cells[ci] = cellValue(typeM ? typeM[1] : null, body, shared);
    }
    // 稀疏数组 → 矩形行：没出现的格子补空串，调用方就不必再防 undefined
    rows.push(Array.from({ length: cells.length }, (_, i) => (cells[i] == null ? '' : cells[i])));
  }
  return rows;
}

function parseRels(xml) {
  const map = {};
  if (!xml) return map;
  const re = /<Relationship\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = /\bId="([^"]*)"/.exec(m[0]);
    const target = /\bTarget="([^"]*)"/.exec(m[0]);
    const mode = /\bTargetMode="External"/.test(m[0]);
    if (id && target && !mode) map[id[1]] = xmlUnesc(target[1]);
  }
  return map;
}

/**
 * xlsx 字节 → [{ name, rows }]（按工作簿里的顺序）。
 * 读不出工作簿结构时抛错；单个工作表坏掉则跳过，不让一张表拖垮整次导入。
 */
export function readXlsx(bytes) {
  const files = zipRead(bytes);
  const dec = (name) => {
    const b = files.get(name);
    return b ? utf8Dec.decode(b) : null;
  };

  const wb = dec('xl/workbook.xml');
  if (!wb) throw new Error('不是有效的 xlsx（缺少 xl/workbook.xml）');
  const rels = parseRels(dec('xl/_rels/workbook.xml.rels'));
  const shared = parseSharedStrings(dec('xl/sharedStrings.xml'));

  const sheets = [];
  const re = /<sheet\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(wb))) {
    const name = xmlUnesc((/\bname="([^"]*)"/.exec(m[0]) || [])[1] || '');
    const rid = (/\br:id="([^"]*)"/.exec(m[0]) || [])[1];
    let target = rid ? rels[rid] : null;
    if (!target && !rid) target = `worksheets/sheet${sheets.length + 1}.xml`;
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = dec(path) ?? dec(path.replace(/^xl\//, ''));
    if (xml == null) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}
