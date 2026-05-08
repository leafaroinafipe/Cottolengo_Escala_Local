@echo off
chcp 65001 >nul
title Cottolengo Escala - Painel Admin
echo ========================================
echo   Iniciando Cottolengo Escala (Admin)
echo ========================================
echo.

cd /d "%~dp0"

REM Verifica se Node.js esta instalado
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo.
    echo Baixe e instale o Node.js em: https://nodejs.org/
    echo Escolha a versao "LTS". Depois reinicie este atalho.
    pause
    exit /b 1
)

REM Instala dependencias se nao existir node_modules
if not exist "node_modules\" (
    echo [1/2] Instalando dependencias pela primeira vez...
    echo       Isso pode demorar alguns minutos.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
    echo.
)

echo [2/2] Iniciando o servidor de desenvolvimento...
echo.
echo Quando aparecer uma linha como:
echo    Local:   http://localhost:5173/...
echo abra essa URL no seu navegador (Chrome ou Edge).
echo.
echo Para parar: feche esta janela ou pressione Ctrl+C.
echo ========================================
echo.

call npm run dev
pause
