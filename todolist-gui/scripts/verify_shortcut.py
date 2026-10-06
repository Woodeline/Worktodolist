# 回读校验 .lnk 快捷方式：加载后读取 Target / Arguments / WorkingDirectory / IconLocation
# 用法：python verify_shortcut.py <path.lnk>
import ctypes
import os
import sys
from ctypes import POINTER, byref, c_int, c_long, c_ulong, c_void_p, c_wchar_p, create_unicode_buffer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_shortcut import (  # noqa: E402
    CLSID_SHELL_LINK, IID_IPERSIST_FILE, IID_ISHELL_LINK_W,
    CLSCTX_INPROC_SERVER, GUID, com_method, hr_text, ole32,
)

VT_GET_PATH = 3
VT_GET_DESCRIPTION = 6
VT_GET_WORKINGDIR = 8
VT_GET_ARGUMENTS = 10
VT_GET_ICONLOCATION = 16
VT_QUERYINTERFACE = 0
VT_RELEASE = 2
VT_PERSIST_LOAD = 5


def main():
    if len(sys.argv) < 2:
        print('usage: verify_shortcut.py <path.lnk>')
        return 1
    path = os.path.abspath(sys.argv[1])
    if not os.path.exists(path):
        print('not found: %s' % path)
        return 1

    ole32.CoInitialize(None)
    link = c_void_p()
    hr = ole32.CoCreateInstance(
        byref(CLSID_SHELL_LINK), None, CLSCTX_INPROC_SERVER,
        byref(IID_ISHELL_LINK_W), byref(link),
    )
    if hr != 0 or not link:
        print('CoCreateInstance failed: %s' % hr_text(hr))
        return 1

    try:
        persist = c_void_p()
        hr = com_method(link, VT_QUERYINTERFACE, c_long, POINTER(GUID), POINTER(c_void_p))(
            link, byref(IID_IPERSIST_FILE), byref(persist)
        )
        if hr != 0 or not persist:
            print('QueryInterface failed: %s' % hr_text(hr))
            return 1
        try:
            load = com_method(persist, VT_PERSIST_LOAD, c_long, c_wchar_p, c_ulong)
            hr = load(persist, path, 0)  # STGM_READ = 0
            if hr != 0:
                print('Load failed: %s' % hr_text(hr))
                return 1
        finally:
            com_method(persist, VT_RELEASE, c_ulong)(persist)

        buf = create_unicode_buffer(1024)
        icon_buf = create_unicode_buffer(1024)
        icon_index = c_int()

        def read(index, *argtypes):
            return com_method(link, index, c_long, *argtypes)

        hr_path = read(VT_GET_PATH, c_wchar_p, c_int, c_void_p, c_ulong)(link, buf, 1024, None, 0)
        path_text = buf.value if hr_path == 0 else '<failed %s>' % hr_text(hr_path)

        buf.value = ''
        hr_args = read(VT_GET_ARGUMENTS, c_wchar_p, c_int)(link, buf, 1024)
        args_text = buf.value if hr_args == 0 else '<failed %s>' % hr_text(hr_args)

        buf.value = ''
        hr_wd = read(VT_GET_WORKINGDIR, c_wchar_p, c_int)(link, buf, 1024)
        wd_text = buf.value if hr_wd == 0 else '<failed %s>' % hr_text(hr_wd)

        hr_icon = read(VT_GET_ICONLOCATION, c_wchar_p, c_int, POINTER(c_int))(
            link, icon_buf, 1024, byref(icon_index)
        )
        icon_text = '%s,%d' % (icon_buf.value, icon_index.value) if hr_icon == 0 else '<failed %s>' % hr_text(hr_icon)

        buf.value = ''
        hr_desc = read(VT_GET_DESCRIPTION, c_wchar_p, c_int)(link, buf, 1024)
        desc_text = buf.value if hr_desc == 0 else '<failed %s>' % hr_text(hr_desc)
    finally:
        com_method(link, VT_RELEASE, c_ulong)(link)

    print('--- %s ---' % path)
    print('Target        : %s' % path_text)
    print('Arguments     : %s' % args_text)
    print('WorkingDir    : %s' % wd_text)
    print('IconLocation  : %s' % icon_text)
    print('Description   : %s' % desc_text)
    print('exists(target): %s' % os.path.exists(path_text))
    icon_file = icon_text.rsplit(',', 1)[0] if icon_text.startswith('C:') else ''
    if icon_file:
        print('exists(icon)  : %s' % os.path.exists(icon_file))
    return 0


if __name__ == '__main__':
    sys.exit(main())
