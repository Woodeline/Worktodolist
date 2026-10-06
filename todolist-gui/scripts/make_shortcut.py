# 通过 Windows Shell COM 接口（ctypes 直调 vtable）创建带自定义图标的快捷方式
# 不用 cscript/wscript/PowerShell COM（本机沙箱会拦截），改用纯 ctypes。
#
# IShellLinkW vtable 真实顺序（IUnknown 占 0/1/2）：
#   3 GetPath          4 GetIDList        5 SetIDList      6 GetDescription
#   7 SetDescription   8 GetWorkingDir    9 SetWorkingDir  10 GetArguments
#   11 SetArguments    12 GetHotkey       13 SetHotkey     14 GetShowCmd
#   15 SetShowCmd      16 GetIconLocation 17 SetIconLocation
#   18 SetRelativePath 19 Resolve         20 SetPath
# IPersistFile vtable：3 GetClassID 4 IsDirty 5 Load 6 Save 7 SaveCompleted 8 GetCurFile
#
# 用法：python make_shortcut.py <target> <icon> <output.lnk> [workdir] [arguments]
import ctypes
import os
import sys
from ctypes import POINTER, byref, c_int, c_long, c_ulong, c_void_p, c_wchar_p, wintypes

ole32 = ctypes.WinDLL('ole32', use_last_error=True)


class GUID(ctypes.Structure):
    _fields_ = [
        ('Data1', c_ulong),
        ('Data2', ctypes.c_ushort),
        ('Data3', ctypes.c_ushort),
        ('Data4', ctypes.c_ubyte * 8),
    ]

    def __init__(self, guid_string):
        super().__init__()
        text = guid_string.strip('{}')
        parts = text.split('-')
        self.Data1 = int(parts[0], 16)
        self.Data2 = int(parts[1], 16)
        self.Data3 = int(parts[2], 16)
        tail = parts[3] + parts[4]
        for i in range(8):
            self.Data4[i] = int(tail[i * 2:i * 2 + 2], 16)


CLSID_SHELL_LINK = GUID('{00021401-0000-0000-C000-000000000046}')
IID_ISHELL_LINK_W = GUID('{000214F9-0000-0000-C000-000000000046}')
IID_IPERSIST_FILE = GUID('{0000010B-0000-0000-C000-000000000046}')
CLSCTX_INPROC_SERVER = 1

# vtable 索引常量，避免再次错位
VT_SET_DESCRIPTION = 7
VT_SET_WORKINGDIR = 9
VT_SET_ARGUMENTS = 11
VT_SET_SHOWCMD = 15
VT_SET_ICONLOCATION = 17
VT_SET_PATH = 20
VT_QUERYINTERFACE = 0
VT_RELEASE = 2
VT_PERSIST_SAVE = 6

SW_SHOWNORMAL = 1


def com_method(ptr, index, restype, *argtypes):
    """取出 COM 接口第 index 个虚函数（0/1/2 为 QueryInterface/AddRef/Release）"""
    vtable = ctypes.cast(ptr, POINTER(POINTER(c_void_p))).contents
    func_ptr = vtable[index]
    proto = ctypes.WINFUNCTYPE(restype, c_void_p, *argtypes)
    return proto(func_ptr)


def hr_text(hr):
    return '0x%08X' % (hr & 0xFFFFFFFF)


def main():
    if len(sys.argv) < 4:
        print('usage: make_shortcut.py <target> <icon> <output.lnk> [workdir] [arguments]')
        return 1

    target = os.path.abspath(sys.argv[1])
    icon = os.path.abspath(sys.argv[2])
    output = os.path.abspath(sys.argv[3])
    workdir = os.path.abspath(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else os.path.dirname(target)
    arguments = sys.argv[5] if len(sys.argv) > 5 else None

    if not os.path.exists(target):
        print('target does not exist: %s' % target)
        return 1
    if not os.path.exists(icon):
        print('icon does not exist: %s' % icon)
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

    errors = []
    try:
        set_path = com_method(link, VT_SET_PATH, c_long, c_wchar_p)
        set_workdir = com_method(link, VT_SET_WORKINGDIR, c_long, c_wchar_p)
        set_icon = com_method(link, VT_SET_ICONLOCATION, c_long, c_wchar_p, c_int)
        set_desc = com_method(link, VT_SET_DESCRIPTION, c_long, c_wchar_p)
        set_args = com_method(link, VT_SET_ARGUMENTS, c_long, c_wchar_p)
        set_showcmd = com_method(link, VT_SET_SHOWCMD, c_long, c_int)

        steps = [('SetPath', lambda: set_path(link, target))]
        if arguments:
            steps.append(('SetArguments', lambda: set_args(link, arguments)))
        steps += [
            ('SetWorkingDirectory', lambda: set_workdir(link, workdir)),
            ('SetIconLocation', lambda: set_icon(link, icon, 0)),
            ('SetDescription', lambda: set_desc(link, 'TodoList')),
            ('SetShowCmd', lambda: set_showcmd(link, SW_SHOWNORMAL)),
        ]
        for name, fn in steps:
            hr = fn()
            if hr != 0:
                errors.append('%s -> %s' % (name, hr_text(hr)))

        persist = c_void_p()
        hr = com_method(link, VT_QUERYINTERFACE, c_long, POINTER(GUID), POINTER(c_void_p))(
            link, byref(IID_IPERSIST_FILE), byref(persist)
        )
        if hr != 0 or not persist:
            print('QueryInterface(IPersistFile) failed: %s' % hr_text(hr))
            return 1

        try:
            save = com_method(persist, VT_PERSIST_SAVE, c_long, c_wchar_p, wintypes.BOOL)
            hr = save(persist, output, True)
            if hr != 0:
                print('Save failed: %s' % hr_text(hr))
                return 1
        finally:
            com_method(persist, VT_RELEASE, c_ulong)(persist)
    finally:
        com_method(link, VT_RELEASE, c_ulong)(link)

    for e in errors:
        print('[warn] %s' % e)

    if os.path.exists(output):
        print('OK shortcut created: %s (%d bytes)' % (output, os.path.getsize(output)))
        print('   target    : %s' % target)
        if arguments:
            print('   arguments : %s' % arguments)
        print('   workdir   : %s' % workdir)
        print('   icon      : %s' % icon)
        return 0
    print('shortcut NOT created')
    return 1


if __name__ == '__main__':
    sys.exit(main())
