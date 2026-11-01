#ifndef BRISK_NATIVE_STDIO_H
#define BRISK_NATIVE_STDIO_H

#include <stdio.h>

/* Older MinGW GCC versions still check stdio builtins using MSVCRT formats,
 * even with __USE_MINGW_ANSI_STDIO=1. Name MinGW's GNU-format implementations
 * explicitly so both the checker and runtime support C99 size_t formats.
 * Keep -Wformat and -Werror enabled. */
#if defined(__MINGW32__)
#undef printf
#define printf __mingw_printf
#undef fprintf
#define fprintf __mingw_fprintf
#undef sprintf
#define sprintf __mingw_sprintf
#undef snprintf
#define snprintf __mingw_snprintf
#undef vprintf
#define vprintf __mingw_vprintf
#undef vfprintf
#define vfprintf __mingw_vfprintf
#undef vsprintf
#define vsprintf __mingw_vsprintf
#undef vsnprintf
#define vsnprintf __mingw_vsnprintf
#endif

#endif
