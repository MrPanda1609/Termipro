@echo off
setlocal

if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" (
  call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=x64
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" (
  call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64
) else (
  echo VsDevCmd.bat not found
  exit /b 1
)

echo.
echo === cl ===
where cl
echo.
echo === msbuild ===
where msbuild
echo.
echo === versions ===
node -v
npm -v
py --version
echo.
echo === compiler ===
cl /Bv

