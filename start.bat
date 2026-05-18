@echo off
title UniFlow
color 0A
echo.
echo  ╔══════════════════════════════════╗
echo  ║        UniFlow - Iniciando       ║
echo  ╚══════════════════════════════════╝
echo.

:: Libera a porta 3001 caso esteja ocupada
echo  [1/3] Liberando porta 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo        OK

:: Libera a porta 5173 caso esteja ocupada
echo  [2/3] Liberando porta 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo        OK

:: Inicia servidor e cliente em janelas separadas
echo  [3/3] Iniciando servidor e cliente...
start "UniFlow - Servidor" cmd /k "cd /d %~dp0server && npm run dev"
timeout /t 3 /nobreak >nul
start "UniFlow - Cliente" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo  ✓ UniFlow iniciado com sucesso!
echo.
echo  Servidor : http://localhost:3001
echo  App      : http://localhost:5173
echo.
echo  Feche esta janela quando quiser.
echo.
pause
