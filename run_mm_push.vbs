' Launches the MM yields push with no visible console window (window style 0).
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\JamesWhitaker\OneDrive - Aylett & Co\Desktop\fixed-income-dashboard\push_mm_yields.js""", 0, False
