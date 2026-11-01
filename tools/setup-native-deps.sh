#!/usr/bin/env bash
# Check before downloading game sources. --install installs missing Debian/Ubuntu tools.
set -euo pipefail
target="${1:-windows}"
mode="${2:---check}"
case "$target" in windows|linux);; *) exit 2;; esac
case "$mode" in --check|--install);; *) exit 2;; esac
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$2"); }
need gcc build-essential
need make build-essential
need git git
need python3 python3
need pkg-config pkg-config
need curl curl
need tar tar
need sha256sum coreutils
if ! command -v pkg-config >/dev/null || ! pkg-config --exists libpng; then missing+=(libpng-dev); fi
if ! command -v gcc >/dev/null || ! printf 'int main(void){return 0;}\n' | gcc -m32 -x c -o /dev/null - 2>/dev/null; then
    missing+=(gcc-multilib libc6-dev-i386)
fi
if [ "$target" = windows ]; then
    need clang clang
    need x86_64-w64-mingw32-gcc gcc-mingw-w64-x86-64
    need x86_64-w64-mingw32-windres binutils-mingw-w64-x86-64
    need x86_64-w64-mingw32-as binutils-mingw-w64-x86-64
elif ! command -v pkg-config >/dev/null || ! pkg-config --exists sdl2; then
    missing+=(libsdl2-dev)
fi
if [ "${#missing[@]}" -eq 0 ]; then echo 'Native compiler prerequisites are ready.'; exit 0; fi
printf 'Missing native build packages: %s\n' "${missing[*]}" >&2
if [ "$mode" = --check ]; then
    printf 'Run: bash tools/setup-native-deps.sh %s --install\n' "$target" >&2
    exit 1
fi
if ! command -v apt-get >/dev/null; then
    echo 'Automatic setup requires Debian/Ubuntu. Install the listed equivalents for your distro.' >&2
    exit 1
fi
privilege=()
if [ "$(id -u)" -ne 0 ]; then
    if ! command -v sudo >/dev/null; then echo 'Install the packages above as an administrator (sudo is unavailable).' >&2; exit 1; fi
    echo 'WSL may ask for your Linux password to install the missing compilers.'
    privilege=(sudo)
fi
"${privilege[@]}" apt-get update < /dev/null
"${privilege[@]}" apt-get install -y --no-install-recommends "${missing[@]}" < /dev/null
echo 'Native build dependencies installed.'
