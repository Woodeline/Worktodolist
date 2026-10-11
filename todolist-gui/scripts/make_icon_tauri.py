# 生成 **Tauri 版专属**图标（橙色）。
#
# 为什么不直接改 make_icon.py：
#   make_icon.py 生成的是**共用**的 `<仓库根>/todolist.ico`，它同时被
#     - todolist-gui/public/todolist.ico → index.html 的 favicon（前端共用）
#     - 以及（历史上）旧 PyInstaller 打包链路（scripts/build_exe.py，已从本分支移除）
#   使用。改它就会波及非 Tauri 版本，违背「改动只作用于 Tauri 版」的要求。
#
# 本脚本的做法：**复用 make_icon.py 的绘制代码**（render / png_bytes / ico_bytes），
# 只把配色换成橙色，输出到 Tauri 专用的 src-tauri/icons/ 下。
# 因此形状、比例、超采样抗锯齿与原图完全一致，只有色相变了。
#
# 用法：
#   python scripts/make_icon_tauri.py            # 生成并覆盖 src-tauri/icons/{icon.ico,icon.png}
#   python scripts/make_icon_tauri.py --check    # 只报告当前文件状态，不写任何东西
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icon  # noqa: E402  —— 复用其渲染逻辑，不重写绘图代码

# 橙色配色：与原 BLUE(47,111,235) / BLUE_DARK(31,82,190) 同等的饱和度与明度层级
ORANGE = (249, 115, 22)       # #F97316  顶部（与白对勾对比度足够）
ORANGE_DARK = (194, 65, 12)   # #C2410C  底部，保留原图的垂直渐变层次

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_TAURI = os.path.normpath(os.path.join(HERE, '..', 'src-tauri'))
ICO_OUT = os.path.join(SRC_TAURI, 'icons', 'icon.ico')
PNG_OUT = os.path.join(SRC_TAURI, 'icons', 'icon.png')


def read_ico_entries(path):
    """读出 ICO 里每个尺寸的 (宽, 高, 字节数)，用于报告与自检。"""
    with open(path, 'rb') as fh:
        data = fh.read()
    if len(data) < 6:
        return []
    _rsv, typ, cnt = struct.unpack('<HHH', data[:6])
    if typ != 1:
        return []
    out = []
    for i in range(cnt):
        base = 6 + 16 * i
        w, h, _c, _r, _p, bpp, size, _off = struct.unpack('<BBBBHHII', data[base:base + 16])
        out.append((w or 256, h or 256, bpp, size))
    return out


def png_top_bottom(path):
    """从 PNG 里取顶部中心与底部中心像素，用来证明"真的变橙了"。"""
    with open(path, 'rb') as fh:
        data = fh.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', data[16:24])
    # 只处理本脚本自己产出的格式：8bit / RGBA(6) / 无隔行，单个 IDAT
    pos, idat = 8, b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if tag == b'IDAT':
            idat += body
        pos += 12 + ln
    import zlib
    raw = zlib.decompress(idat)
    stride = w * 4 + 1

    def pixel(y):
        row = raw[y * stride + 1:(y + 1) * stride]
        x = w // 2
        return tuple(row[x * 4:x * 4 + 4])

    return w, h, pixel(int(h * 0.10)), pixel(int(h * 0.90))


def main():
    check_only = '--check' in sys.argv

    print('目标目录 : %s' % os.path.dirname(ICO_OUT))
    print('配色     : 顶 %s (#%02X%02X%02X) -> 底 %s (#%02X%02X%02X)'
          % (ORANGE, *ORANGE, ORANGE_DARK, *ORANGE_DARK))
    print()

    if os.path.isfile(ICO_OUT):
        print('当前 icon.ico : %d B, %d 个尺寸'
              % (os.path.getsize(ICO_OUT), len(read_ico_entries(ICO_OUT))))
    if os.path.isfile(PNG_OUT):
        info = png_top_bottom(PNG_OUT)
        if info:
            w, h, top, bot = info
            print('当前 icon.png : %dx%d, 顶像素 RGBA=%s 底像素 RGBA=%s' % (w, h, top, bot))
            print('               -> 判断: %s'
                  % ('已是橙色' if top[0] > top[2] else '是蓝色（尚未改）'))
    if check_only:
        return 0

    print()
    print('开始渲染（超采样 %dx，7 个尺寸）...' % make_icon.SS)
    # 只替换配色；render() 在调用时才读这两个模块级变量，所以覆盖即生效
    make_icon.BLUE = ORANGE
    make_icon.BLUE_DARK = ORANGE_DARK

    entries = []
    for size in make_icon.SIZES:
        rgba = make_icon.render(size)
        entries.append((size, make_icon.png_bytes(size, size, rgba)))
        print('  rendered %3dx%-3d  %6d B' % (size, size, len(entries[-1][1])))

    os.makedirs(os.path.dirname(ICO_OUT), exist_ok=True)
    with open(ICO_OUT, 'wb') as fh:
        fh.write(make_icon.ico_bytes(entries))
    print('written  %s (%d B)' % (ICO_OUT, os.path.getsize(ICO_OUT)))

    # icon.png = 256x256 那张，与原先 3801 B 的 icon.png 同规格
    big = dict(entries)[256]
    with open(PNG_OUT, 'wb') as fh:
        fh.write(big)
    print('written  %s (%d B)' % (PNG_OUT, os.path.getsize(PNG_OUT)))

    print()
    print('自检:')
    print('  icon.ico 尺寸表:')
    for w, h, bpp, size in read_ico_entries(ICO_OUT):
        print('    %3dx%-3d bpp=%-3d %6d B' % (w, h, bpp, size))
    info = png_top_bottom(PNG_OUT)
    if info:
        w, h, top, bot = info
        print('  icon.png 顶像素 RGBA=%s 底像素 RGBA=%s' % (top, bot))
        ok = top[0] > top[2] and top[1] > top[2]
        print('  橙色判定: %s' % ('通过' if ok else '失败'))
        return 0 if ok else 1
    return 1


if __name__ == '__main__':
    sys.exit(main())
