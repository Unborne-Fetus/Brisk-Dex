#ifndef BRISK_NATIVE_STDIO_H
#define BRISK_NATIVE_STDIO_H

#include <stdio.h>

/* Older MinGW GCC versions still check stdio builtins using MSVCRT formats,
 * even with __USE_MINGW_ANSI_STDIO=1. Name MinGW's GNU-format implementations
 * explicitly so both the checker and runtime support C99 size_t formats.
 * Keep -Wformat and -Werror enabled. */
#if defined(__MINGW32__)
#undef printf
#define printf(...) __mingw_printf(__VA_ARGS__)
#undef fprintf
#define fprintf(...) __mingw_fprintf(__VA_ARGS__)
#undef sprintf
#define sprintf(...) __mingw_sprintf(__VA_ARGS__)
#undef snprintf
#define snprintf(...) __mingw_snprintf(__VA_ARGS__)
#undef vprintf
#define vprintf(...) __mingw_vprintf(__VA_ARGS__)
#undef vfprintf
#define vfprintf(...) __mingw_vfprintf(__VA_ARGS__)
#undef vsprintf
#define vsprintf(...) __mingw_vsprintf(__VA_ARGS__)
#undef vsnprintf
#define vsnprintf(...) __mingw_vsnprintf(__VA_ARGS__)
#endif

#endif
