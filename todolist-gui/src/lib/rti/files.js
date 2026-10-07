// 工具里用到的文件输出：下载 / CSV / 画布转 PNG。
//
// 抽出来是因为三个页面都要用（页 1、页 2 导出 PNG 与 CSV，全局还要导出/导入 JSON），
// 而且它们都是"碰到浏览器 API 的脏活"，不适合散在组件里。

/** 文件名时间戳 YYYYMMDD-HHmm */
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 触发一次浏览器下载（用完即回收 objectURL） */
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

export function downloadJSON(name, data) {
  download(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

function csvCell(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV（带 BOM，否则 Excel 里中文会乱码） */
export function downloadCSV(name, rows) {
  const txt = `\ufeff${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}`;
  download(name, new Blob([txt], { type: 'text/csv' }));
}

/** 画布 → PNG。图表是"看得见但拷不走"的，所以必须留一条导出通路。 */
export function downloadCanvasPNG(canvas, name) {
  if (!canvas) return;
  canvas.toBlob((b) => {
    if (b) download(name, b);
  }, 'image/png');
}

/** 读取用户选中的文件为文本（用于导入 JSON），失败时把原因交给调用方 */
export function readTextFile(input) {
  const f = input.files && input.files[0];
  input.value = ''; // 允许重复选择同一个文件
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result));
    rd.onerror = () => reject(new Error('文件读取失败'));
    rd.readAsText(f);
  });
}
