/*
 * Android-specific arm_division.c lifecycle replacement.
 *
 * AArch64 SDIV/UDIV do not produce x86 SIGFPE, so the desktop exception
 * decoder is inapplicable. Every integer div/rem operation in the game
 * objects MUST be converted by tools/rewrite_android_division_ir.py before
 * the optimized ARM64 machine-code generation. The actual GBA/APCS
 * behavior is in gba_division_android.c; this module only keeps the
 * platform lifecycle ABI, without registering a nonexistent SIGFPE trap.
 */
#include "arm_division.h"

int arm_division_init(void)
{
    return ARM_DIVISION_OK;
}

void arm_division_shutdown(void)
{
}
