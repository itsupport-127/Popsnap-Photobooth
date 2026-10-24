@echo off
title POPSNAP - Buat aplikasi .exe
color 0D
echo ===================================
echo   POPSNAP - Membuat installer .exe
echo   (butuh internet + Node.js 22 atau lebih baru)
echo ===================================
echo.

echo [1/4] Install dependencies backend (tanpa paket dev)...
cd backend
call npm install --omit=dev
if errorlevel 1 goto gagal
cd ..

echo [2/4] Build frontend...
cd frontend
call npm install
if errorlevel 1 goto gagal
set POPSNAP_EXE=1
call npm run build
if errorlevel 1 goto gagal
cd ..

echo [3/4] Install Electron + builder...
cd electron
call npm install
if errorlevel 1 goto gagal

echo [4/4] Membuat installer (beberapa menit)...
call npm run build:win
if errorlevel 1 goto gagal
cd ..

echo.
echo ===================================
echo   SELESAI. Installer ada di:
echo   electron\dist\  (file "POPSNAP Setup x.x.x.exe")
echo ===================================
explorer electron\dist
pause
exit /b 0

:gagal
echo.
echo *** GAGAL. Baca pesan merah di atas, lalu coba lagi. ***
pause
exit /b 1
