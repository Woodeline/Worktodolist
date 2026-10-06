# 生成 TodoList 图标（纯标准库，不依赖 Pillow）
# 输出：工作区根目录 todolist.ico（多尺寸 PNG 压缩 ICO，Windows Vista+ 可用）
import os
import struct
import zlib

SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 4  # 超采样倍数，先画大图再缩小，得到抗锯齿边缘

BLUE = (47, 111, 235)
BLUE_DARK = (31, 82, 190)
WHITE = (255, 255, 255)


def rounded_rect_alpha(x, y, size, radius, inset):
    """点 (x,y) 是否在圆角矩形内（含 inset 内缩）"""
    left, top = inset, inset
    right, bottom = size - inset, size - inset
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def seg_distance(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length2 = vx * vx + vy * vy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length2))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return (dx * dx + dy * dy) ** 0.5


def render(size):
    big = size * SS
    # 圆角方块背景（带轻微垂直渐变）
    row_bg = []
    for y in range(big):
        t = y / (big - 1)
        color = tuple(int(BLUE[i] + (BLUE_DARK[i] - BLUE[i]) * t) for i in range(3))
        row_bg.append(color)

    # 对勾三点（比例坐标）
    p1 = (0.255 * big, 0.510 * big)
    p2 = (0.430 * big, 0.665 * big)
    p3 = (0.755 * big, 0.320 * big)
    half = 0.052 * big  # 笔画半宽

    radius = 0.22 * big
    inset = 0.012 * big

    # 超采样累加
    acc = [0.0] * (size * size * 4)
    for y in range(big):
        bg = row_bg[y]
        for x in range(big):
            ox, oy = x // SS, y // SS
            idx = (oy * size + ox) * 4
            inside = rounded_rect_alpha(x + 0.5, y + 0.5, big, radius, inset)
            if inside:
                r, g, b, a = bg[0], bg[1], bg[2], 255
                d = min(
                    seg_distance(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]),
                    seg_distance(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]),
                )
                if d <= half:
                    r, g, b = WHITE
                acc[idx] += r
                acc[idx + 1] += g
                acc[idx + 2] += b
                acc[idx + 3] += a

    n = SS * SS
    out = bytearray(size * size * 4)
    for i in range(size * size * 4):
        out[i] = int(acc[i] / n + 0.5)
    return bytes(out)


def png_bytes(w, h, rgba):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def ico_bytes(entries):
    out = struct.pack('<HHH', 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dirs = b''
    for size, data in entries:
        dim = 0 if size >= 256 else size
        dirs += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return out + dirs + b''.join(d for _, d in entries)


def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    target = os.path.join(root, 'todolist.ico')
    entries = []
    for size in SIZES:
        entries.append((size, png_bytes(size, size, render(size))))
        print('rendered %dx%d' % (size, size))
    with open(target, 'wb') as fh:
        fh.write(ico_bytes(entries))
    print('written: %s (%d bytes)' % (target, os.path.getsize(target)))


if __name__ == '__main__':
    main()
