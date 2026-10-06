' 待办清单 · 备用启动方式（不产生控制台窗口）
'
' 现在只是个薄封装：真正的逻辑都在 launch_todolist.py 里，
' 桌面 TodoList 图标指的也是同一个文件，两条路径行为完全一致。
'
' 保留它的意义：万一 .lnk 快捷方式被删了/被杀软拦了，双击这个 .vbs 同样能起来。
'
' 历史缺陷（已修）：
'   旧版自己起服务，只 sleep 2.2 秒就无脑用「默认浏览器」打开页面。
'   如果默认浏览器是 Firefox，本应用依赖的 File System Access API 不被支持，
'   页面会直接不可用；而且 2.2 秒也不保证服务已就绪。
'   现在交给 launch_todolist.py：会真正轮询端口，并强制用 Edge/Chrome 打开。
Option Explicit

Dim fso, shell, baseDir, launcher, pyw
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(baseDir, "launch_todolist.py")
pyw = shell.ExpandEnvironmentStrings("%USERPROFILE%") & _
      "\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe"

If Not fso.FileExists(pyw) Then pyw = "pythonw"

If Not fso.FileExists(launcher) Then
  MsgBox "找不到 launch_todolist.py：" & vbCrLf & launcher & vbCrLf & vbCrLf & _
         "请确认这个文件还在 todolist 文件夹里。", 16, "待办清单"
  WScript.Quit 1
End If

' 0 = 隐藏窗口，False = 不等它跑完
On Error Resume Next
shell.Run """" & pyw & """ """ & launcher & """", 0, False
If Err.Number <> 0 Then
  MsgBox "启动失败：" & vbCrLf & Err.Description, 16, "待办清单"
  WScript.Quit 1
End If
