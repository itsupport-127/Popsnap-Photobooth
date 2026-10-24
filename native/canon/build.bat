@echo off
REM Membangun popsnap_canon_bridge.exe (32-bit).
REM Jalankan dari "x86 Native Tools Command Prompt for VS 2022" (bukan x64!). Dari menu Start cari: "x86 Native Tools".
cd /d "%~dp0"
cl /nologo /O2 /EHsc /std:c++17 /MT popsnap_canon_bridge.cpp /Fe:popsnap_canon_bridge.exe /link user32.lib
if errorlevel 1 (echo GAGAL membangun & exit /b 1)
echo.
echo Selesai: %~dp0popsnap_canon_bridge.exe
echo Salin ke backend\sdk\canon\ (satu folder dengan EDSDK.dll dan EdsImage.dll), lalu build-exe.bat.
