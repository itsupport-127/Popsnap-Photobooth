@echo off
REM Membangun popsnap_nikon_bridge.exe (64-bit) memakai compiler C# bawaan Windows (tanpa Visual Studio).
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
if not exist "%FW%\csc.exe" ( echo csc.exe tidak ditemukan di %FW% & exit /b 1 )
"%FW%\csc.exe" /nologo /unsafe /platform:x64 /target:exe /out:popsnap_nikon_bridge.exe /lib:"%FW%\WPF" /r:WindowsBase.dll /r:System.Core.dll Program.cs wrapper\*.cs
if errorlevel 1 ( echo GAGAL membangun. Kirim pesan error di atas ke saya. & exit /b 1 )
echo.
echo Selesai: popsnap_nikon_bridge.exe
echo Salin ke backend\sdk\nikon\ (satu level di atas folder model, mis. backend\sdk\nikon\popsnap_nikon_bridge.exe)
endlocal
