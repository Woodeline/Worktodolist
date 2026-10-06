"""把 C:\\Users\\王佐成\\bin 追加到用户级 PATH（HKCU\\Environment\\Path）。

要点：
1. 先备份原值为脚本同目录下的 path_backup.txt（含注册表值类型），便于一键还原；
2. 写入时保持原有的值类型（REG_SZ / REG_EXPAND_SZ），避免破坏 %USERPROFILE% 展开；
3. 只做追加，不删除、不重排任何已有条目；已存在则跳过。
"""
import os
import winreg

BIN_DIR = "C:" + os.sep + "Users" + os.sep + "王佐成" + os.sep + "bin"
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "path_backup.txt")

TYPES = {winreg.REG_SZ: "REG_SZ", winreg.REG_EXPAND_SZ: "REG_EXPAND_SZ"}

with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    old_value, old_type = winreg.QueryValueEx(k, "Path")

print("写入类型 :", TYPES.get(old_type, old_type))

# 1) 备份
with open(BACKUP, "w", encoding="utf-8") as f:
    f.write(f"# 备份时间 2026-09-30 / 注册表值类型 {TYPES.get(old_type, old_type)}\n")
    f.write(f"# 还原命令：见文件末尾注释\n")
    f.write(old_value + "\n")
print("已备份至 :", BACKUP)

# 2) 判断是否已存在（忽略大小写与结尾反斜杠）
entries = [e for e in old_value.split(";") if e.strip()]
norm = lambda s: s.strip().rstrip("\\/").lower()
if norm(BIN_DIR) in [norm(e) for e in entries]:
    print("结果     : 已存在，无需修改")
else:
    new_value = old_value.rstrip(";") + ";" + BIN_DIR
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "Path", 0, old_type, new_value)

    # 3) 回读校验
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
        check, _ = winreg.QueryValueEx(k, "Path")
    print("追加后条目:")
    for e in check.split(";"):
        if e.strip():
            print("   ", e, "  <-- 新增" if norm(e) == norm(BIN_DIR) else "")
    print("结果     :", "写入成功" if norm(BIN_DIR) in [norm(e) for e in check.split(";")] else "写入失败")

with open(BACKUP, "a", encoding="utf-8") as f:
    f.write("\n# 还原方式（PowerShell，需重开终端）：\n")
    f.write('# [Environment]::SetEnvironmentVariable("Path", "<上面备份的原始值>", "User")\n')
