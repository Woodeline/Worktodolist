// 工具里用到的文件读写：另存为 / xlsx / 画布转 PNG。
//
// 抽出来是因为多个地方都要用（结果页与对比页导出 PNG，工具右上角导出/导入 xlsx），
// 而且它们都是"碰到浏览器 API 的脏活"，不适合散在组件里。
import { invoke, isTauri } from '../runtime.js';
import { buildXlsx } from './xlsx.js';

/** 文件名时间戳 YYYYMMDD-HHmm */
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 触发一次浏览器下载（用完即回收 objectURL）。仅作"没得选位置"时的兜底。 */
export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** xlsx 的 MIME —— Excel 认这个类型，浏览器也据此给文件配图标 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 让用户**自己挑保存位置**。返回 `'saved' | 'cancelled' | 'unsupported'`，三条通路
 * 按"能用到不能用"排：
 *   1. Tauri 壳 —— 原生「另存为」对话框（Rust 命令 `fs_save_as`，与选数据目录同一套）；
 *   2. 浏览器 File System Access API —— `showSaveFilePicker`（Edge / Chrome）；
 *   3. 都不行 —— `'unsupported'`，由调用方回落到"下载到默认目录"。
 *
 * **取消就是取消**：用户关掉对话框返回 `'cancelled'`，调用方不要再偷偷下载一份。
 * 之前直接 `a.download` 是没有这一步的 —— 文件只能落在浏览器的下载目录里。
 */
async function saveBytesAs(name, bytes, mime) {
  const ext = name.split('.').pop().toLowerCase();
  if (isTauri()) {
    const ok = await invoke('fs_save_as', { name, data: Array.from(bytes) });
    return ok ? 'saved' : 'cancelled';
  }
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }],
      });
      const w = await handle.createWritable();
      await w.write(new Blob([bytes], { type: mime }));
      await w.close();
      return 'saved';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  return 'unsupported';
}

/** 工作簿导出。sheets: [{ name, rows }]，rows 是二维数组（见 lib/rti/xlsx.js）。
 *  先弹「另存为」让用户选位置；选不了（老环境）才回落到浏览器默认下载。
 *  返回是否真的写出了文件 —— 用户取消时返回 false，调用方据此不要报"已导出"。 */
export async function downloadXLSX(name, sheets) {
  const bytes = buildXlsx(sheets);
  const how = await saveBytesAs(name, bytes, XLSX_MIME);
  if (how === 'cancelled') return false;
  if (how === 'unsupported') download(name, new Blob([bytes], { type: XLSX_MIME }));
  return true;
}

/** PNG 的 MIME */
const PNG_MIME = 'image/png';

/** 画布 → PNG 字节（`toBlob` 是回调式，这里包成 Promise）。 */
function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    if (!canvas) resolve(null);
    else canvas.toBlob((b) => resolve(b), PNG_MIME);
  });
}

/** 画布 → PNG。图表是"看得见但拷不走"的，所以必须留一条导出通路。
 *  与 xlsx 同一套：先弹「另存为」让用户选位置，选不了才回落到默认下载。
 *  返回是否真的写出了文件（用户取消时为 false）。 */
export async function downloadCanvasPNG(canvas, name) {
  const blob = await canvasToPngBlob(canvas);
  if (!blob) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const how = await saveBytesAs(name, bytes, PNG_MIME);
  if (how === 'cancelled') return false;
  if (how === 'unsupported') download(name, blob);
  return true;
}

/** 读取用户选中的文件为字节（xlsx 是二进制），失败时把原因交给调用方 */
export function readArrayBuffer(input) {
  const f = input.files && input.files[0];
  input.value = ''; // 允许重复选择同一个文件
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result);
    rd.onerror = () => reject(new Error('文件读取失败'));
    rd.readAsArrayBuffer(f);
  });
}
