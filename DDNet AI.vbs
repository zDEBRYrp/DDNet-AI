Option Explicit

Dim fso, shell, root, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(root, "app-win\DDNet AI.exe")

If fso.FileExists(exe) Then
  shell.Run Chr(34) & exe & Chr(34), 0, False
Else
  MsgBox "Не найден DDNet AI.exe в папке app-win", 16, "DDNet AI"
End If
