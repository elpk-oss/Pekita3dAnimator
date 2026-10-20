@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PEKITA ANIMATE 3D

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js no está instalado.
  echo Descárgalo desde https://nodejs.org y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando PEKITA ANIMATE 3D...
echo Se abrirá el navegador automáticamente.
echo Para cerrar el servidor, pulsa Ctrl+C en esta ventana.
echo.
call npm run dev -- --open
pause
