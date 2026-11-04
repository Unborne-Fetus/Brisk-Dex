/*
 * Android relocatable replacement for host_linked.c's absolute ELF sections.
 *
 * Bionic loads libbriskgame.so at an ASLR-selected address, so an Android
 * shared library cannot reserve GBA memory by declaring absolute PT_LOAD
 * sections inside itself. Reserve the GBA hardware pages explicitly instead
 * using MAP_FIXED_NOREPLACE, rejecting collisions rather than overwriting
 * an Android mapping. The regions remain at the GBA's actual numeric
 * addresses, preserving REG_*, VRAM, SRAM, EWRAM and DMA pointer semantics.
 *
 * This replaces ONLY the memory-region host symbols. EWRAM_DATA (.sbss)
 * and soft-reset game data in the native executable require a separate
 * Android-compatible section layout; their relocation is not solved here.
 */
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

#include "gba_memmap.h"
#include "host_memory.h"

#define ANDROID_CALL_STACK_BASE UINT32_C(0x01800000)
#define ANDROID_CALL_STACK_SIZE UINT32_C(0x00100000)

/* Size rounded for the GBA-visible host_span remains the desktop 4 KiB
 * layout, even on a 16 KiB Android kernel. Only the mmap allocation widens
 * to accommodate the physical page size. */
#define GBA_REGION_LINK_SIZE(n) (((n) + 4095u) & ~4095u)

struct android_region {
    uintptr_t base;
    size_t size;
};
static const struct android_region mapped_regions[GBA_REGION_COUNT] = {
    [GBA_REGION_EWRAM] = {GBA_EWRAM_BASE, GBA_EWRAM_SIZE},
    [GBA_REGION_IWRAM] = {GBA_IWRAM_BASE, GBA_IWRAM_SIZE},
    [GBA_REGION_IO] = {GBA_IO_BASE, GBA_IO_SIZE},
    [GBA_REGION_MGBA_DEBUG] = {GBA_MGBA_DEBUG_BASE, GBA_MGBA_DEBUG_SIZE},
    [GBA_REGION_PALETTE_RAM] = {GBA_PALETTE_RAM_BASE, GBA_PALETTE_RAM_SIZE},
    [GBA_REGION_VRAM] = {GBA_VRAM_BASE, GBA_VRAM_SIZE},
    [GBA_REGION_OAM] = {GBA_OAM_BASE, GBA_OAM_SIZE},
    [GBA_REGION_SRAM] = {GBA_SRAM_BASE, GBA_SRAM_SIZE},
};

struct android_allocation {
    uintptr_t start;
    size_t size;
};
static struct android_allocation allocations[GBA_REGION_COUNT + 1];
static size_t allocation_count;
static bool mapping_valid;
static pthread_once_t map_once = PTHREAD_ONCE_INIT;

static bool map_exact(uintptr_t address, size_t requested, size_t pagesize)
{
    if (address == 0 || requested == 0 || (pagesize & (pagesize - 1u)) != 0)
        return false;
    const uintptr_t mask = (uintptr_t)pagesize - 1u;
    const uintptr_t start = address & ~mask;
    const uintptr_t end = (address + requested + mask) & ~mask;
    if (end <= start || allocation_count >= GBA_REGION_COUNT + 1)
        return false;
    if (host_memory_map_fixed(start, (size_t)(end - start)) != 0) {
        (void)fprintf(stderr, "android-gba-memory: could not safely reserve 0x%lx + %zu bytes\n",
                      (unsigned long)start, (size_t)(end - start));
        return false;
    }
    allocations[allocation_count++] = (struct android_allocation){start, (size_t)(end - start)};
    return true;
}

static void reserve_all_regions(void)
{
    const long detected = sysconf(_SC_PAGESIZE);
    if (detected < 4096 || ((unsigned long)detected & ((unsigned long)detected - 1u)) != 0)
        return;
    const size_t pagesize = (size_t)detected;
    for (int id = GBA_REGION_NONE + 1; id < GBA_REGION_COUNT; ++id) {
        const struct android_region info = mapped_regions[id];
        if (!map_exact(info.base, GBA_REGION_LINK_SIZE(info.size), pagesize))
            goto rollback;
    }
    if (!map_exact(ANDROID_CALL_STACK_BASE, ANDROID_CALL_STACK_SIZE, pagesize))
        goto rollback;
    mapping_valid = true;
    return;
rollback:
    while (allocation_count != 0) {
        const struct android_allocation allocation = allocations[--allocation_count];
        (void)host_memory_unmap_fixed(allocation.start, allocation.size);
    }
}

struct host_span host_memory_region(enum gba_region region)
{
    (void)pthread_once(&map_once, reserve_all_regions);
    if (!mapping_valid || region <= GBA_REGION_NONE || region >= GBA_REGION_COUNT)
        return (struct host_span){0, 0};
    const struct android_region info = mapped_regions[region];
    return (struct host_span){info.base, info.base + GBA_REGION_LINK_SIZE(info.size)};
}

struct host_span host_memory_call_stack(void)
{
    (void)pthread_once(&map_once, reserve_all_regions);
    if (!mapping_valid)
        return (struct host_span){0, 0};
    return (struct host_span){ANDROID_CALL_STACK_BASE, ANDROID_CALL_STACK_BASE + ANDROID_CALL_STACK_SIZE};
}
