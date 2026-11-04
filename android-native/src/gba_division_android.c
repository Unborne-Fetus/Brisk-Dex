/*
 * ARM7TDMI/APCS-gnu division semantics for the AArch64 native game port.
 *
 * ARM64 hardware's division-by-zero result (zero) differs from the GBA
 * libgcc routines used by pokeemerald. Game LLVM IR must route ALL sdiv,
 * udiv, srem and urem operations here BEFORE optimization. Do not merely
 * link these helpers without running the transform: that would be wrong.
 *
 * Edge values match the pinned native project's measured libgcc vectors:
 * platform/arm_division_libgcc/libgcc_division.txt.
 */
#include <limits.h>
#include <stdint.h>

int32_t brisk_gba_sdiv_i32(int32_t numerator, int32_t denominator)
{
    if (denominator == 0)
        return numerator > 0 ? INT32_MAX : numerator < 0 ? INT32_MIN : 0;
    if (numerator == INT32_MIN && denominator == -1)
        return INT32_MIN;
    return numerator / denominator;
}

int32_t brisk_gba_srem_i32(int32_t numerator, int32_t denominator)
{
    if (denominator == 0)
        return numerator > 0 ? INT32_MAX : numerator < 0 ? INT32_MIN : 0;
    if (numerator == INT32_MIN && denominator == -1)
        return 0;
    return numerator % denominator;
}

uint32_t brisk_gba_udiv_i32(uint32_t numerator, uint32_t denominator)
{
    if (denominator == 0)
        return numerator == 0 ? 0 : UINT32_MAX;
    return numerator / denominator;
}

uint32_t brisk_gba_urem_i32(uint32_t numerator, uint32_t denominator)
{
    if (denominator == 0)
        return numerator == 0 ? 0 : UINT32_MAX;
    return numerator % denominator;
}

/*
 * The 64-bit APCS result is unlike the EABI: with a zero divisor,
 * for a magnitude with k significant bits, quotient = 2^(k+1)-1
 * (saturated at UINT64_MAX). The remainder is the magnitude modulo
 * 2^(64-k). For zero, quotient 1 and remainder zero.
 */
static uint64_t libgcc_zero_div64(uint64_t magnitude)
{
    unsigned k = magnitude == 0 ? 0u : 64u - (unsigned)__builtin_clzll(magnitude);
    return k >= 63u ? UINT64_MAX : (UINT64_C(1) << (k + 1u)) - 1u;
}

static uint64_t libgcc_zero_rem64(uint64_t magnitude)
{
    unsigned k = magnitude == 0 ? 0u : 64u - (unsigned)__builtin_clzll(magnitude);
    if (k <= 32u)
        return magnitude;
    if (k >= 64u)
        return 0u;
    return magnitude & ((UINT64_C(1) << (64u - k)) - 1u);
}

uint64_t brisk_gba_udiv_i64(uint64_t numerator, uint64_t denominator)
{
    return denominator == 0 ? libgcc_zero_div64(numerator) : numerator / denominator;
}

uint64_t brisk_gba_urem_i64(uint64_t numerator, uint64_t denominator)
{
    return denominator == 0 ? libgcc_zero_rem64(numerator) : numerator % denominator;
}

static uint64_t signed_magnitude(int64_t value)
{
    const uint64_t bits = (uint64_t)value;
    return value < 0 ? UINT64_C(0) - bits : bits;
}

int64_t brisk_gba_sdiv_i64(int64_t numerator, int64_t denominator)
{
    if (denominator == 0) {
        const uint64_t quotient = libgcc_zero_div64(signed_magnitude(numerator));
        return (int64_t)(numerator < 0 ? UINT64_C(0) - quotient : quotient);
    }
    if (numerator == INT64_MIN && denominator == -1)
        return INT64_MIN;
    return numerator / denominator;
}

int64_t brisk_gba_srem_i64(int64_t numerator, int64_t denominator)
{
    if (denominator == 0) {
        const uint64_t rem = libgcc_zero_rem64(signed_magnitude(numerator));
        return (int64_t)(numerator < 0 ? UINT64_C(0) - rem : rem);
    }
    if (numerator == INT64_MIN && denominator == -1)
        return 0;
    return numerator % denominator;
}
