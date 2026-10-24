@echo off
title POPSNAP Launcher
color 0D

echo ===================================
echo   POPSNAP - Menjalankan Aplikasi
echo ===================================
echo.

REM ---- Install dependencies kalau belum pernah (cuma jalan sekali) ----
if not exist "backend\node_modules" (
    echo [1/4] Install dependencies backend, ini cuma kejadian sekali di awal...
    cd backend
    call npm install
    cd ..
    echo.
) else (
    echo [1/4] Dependencies backend sudah ada, lanjut.
)

if not exist "frontend\node_modules" (
    echo [2/4] Install dependencies frontend, ini cuma kejadian sekali di awal...
    cd frontend
    call npm install
    cd ..
    echo.
) else (
    echo [2/4] Dependencies frontend sudah ada, lanjut.
)

REM ---- Jalankan backend di jendela terpisah ----
echo [3/4] Menjalankan backend...
start "POPSNAP Backend" cmd /k "cd backend && npm start"

REM Kasih waktu backend siap dulu sebelum frontend jalan
timeout /t 3 /nobreak >nul

REM ---- Jalankan frontend di jendela terpisah ----
echo [4/4] Menjalankan frontend...
start "POPSNAP Frontend" cmd /k "cd frontend && npm run dev"

REM Kasih waktu Vite siap sebelum buka browser
timeout /t 5 /nobreak >nul

REM ---- Buka browser otomatis ----
echo Membuka browser...
start http://localhost:5173

echo.
echo ===================================
echo   POPSNAP sudah jalan!
echo.
echo   - JANGAN tutup 2 jendela hitam yang
echo     barusan kebuka (itu backend & frontend)
echo   - Buat masuk admin: localhost:5173/admin
echo   - Buat tutup semuanya, jalankan
echo     stop-popsnap.bat
echo ===================================
echo.
pause
