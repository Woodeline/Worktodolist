' 待办清单 · Tauri 版 —— 备用启动方式（不产生控制台窗口）
'
' 现在只是个薄封装：真正的逻辑都在 launch_todolist_tauri.py 里，
' 桌面「待办清单-Tauri」图标指的也是同一个文件，两条路径行为完全一致。
'
' 保留它的意义：万一 .lnk 快捷方式被删了 / 被杀软拦了，双击这个 .vbs 同样能起来。
'
' 它做的事：
'   1. 找 Tauri 版构建产物（src-tauri\target\release\Worktodolist.exe）并启动
'   2. 找不到就弹窗说清「还没构建」以及构建命令
'       —— 不再回落打开任何旧版本（旧启动链路已从仓库移除）
Option Explicit

Dim fso, shell, baseDir, launcher, pyw
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(baseDir, "launch_todolist_tauri.py")
pyw = shell.ExpandEnvironmentStrings("%USERPROFILE%") & _
      "\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"

If Not fso.FileExists(pyw) Then pyw = "pythonw"

If Not fso.FileExists(launcher) Then
  MsgBox "找不到 launch_todolist_tauri.py：" & vbCrLf & launcher & vbCrLf & vbCrLf & _
         "请确认这个文件还在 todolist 文件夹里。", 16, "待办清单 · Tauri 版"
  WScript.Quit 1
End If

' 0 = 隐藏窗口，False = 不等它跑完
On Error Resume Next
shell.Run """" & pyw & """ """ & launcher & """", 0, False
If Err.Number <> 0 Then
  MsgBox "启动失败：" & vbCrLf & Err.Description, 16, "待办清单 · Tauri 版"
  WScript.Quit 1
End If
