/*
 * Android/AArch64 native host primitives for the pinned Brisk C backend.
 * Built only for Android ARM64. No replacement gameplay or ROM emulation.
 *
 * The full native link is still blocked by GBA-address section placement
 * and script-pointer tagging. This host implementation does NOT bypass
 * those two requirements.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <link.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/ucontext.h>
#include <unistd.h>

#include "host_fault.h"
#include "host_image.h"
#include "host_internal.h"
#include "host_memory.h"
#include "host_process.h"
#include "host_stack.h"

#ifndef __aarch64__
#error "This Android host layer requires AArch64"
#endif
#ifndef __ANDROID__
#error "Do not compile the Android host layer on desktop Linux"
#endif

/* On AArch64 the fault context exposes x0-x30, SP and PC, not x86 gregs. */
uintptr_t host_fault_register(const struct host_fault *fault, enum host_fault_register name)
{
    if (fault == NULL || fault->context == NULL)
        return 0;
    switch (name) {
    case HOST_FAULT_PC:
        return (uintptr_t)fault->context->uc_mcontext.pc;
    case HOST_FAULT_ACCUMULATOR:
        return (uintptr_t)fault->context->uc_mcontext.regs[0];
    case HOST_FAULT_DATA:
        return (uintptr_t)fault->context->uc_mcontext.regs[1];
    default:
        return 0;
    }
}
void host_fault_set_register(struct host_fault *fault, enum host_fault_register name, uintptr_t value)
{
    if (fault == NULL || fault->context == NULL)
        return;
    switch (name) {
    case HOST_FAULT_PC:
        fault->context->uc_mcontext.pc = value;
        break;
    case HOST_FAULT_ACCUMULATOR:
        fault->context->uc_mcontext.regs[0] = value;
        break;
    case HOST_FAULT_DATA:
        fault->context->uc_mcontext.regs[1] = value;
        break;
    default:
        break;
    }
}
uintptr_t host_fault_general_register(const struct host_fault *fault, unsigned index)
{
    if (fault == NULL || fault->context == NULL)
        return 0;
    return (uintptr_t)fault->context->uc_mcontext.regs[index % 31u];
}

/* Android's /proc/self/exe is app_process, not the game shared library.
 * This path is only used by the desktop restart/test infrastructure.
 * Android must not attempt to exec the application in order to soft reset. */
const char host_self_executable[] = "/proc/self/exe";
int host_process_executable_path(char *out, size_t size)
{
    (void)out;
    (void)size;
    errno = ENOTSUP;
    return -1;
}

#ifndef MAP_FIXED_NOREPLACE
#define MAP_FIXED_NOREPLACE 0x100000
#endif
int host_memory_map_fixed(uintptr_t address, size_t size)
{
    if (address == 0 || size == 0 || address % 4096u != 0 || size % 4096u != 0)
        return -1;
    void *got = mmap((void *)address, size, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
    if (got == MAP_FAILED)
        return -1;
    if ((uintptr_t)got != address) {
        (void)munmap(got, size);
        return -1;
    }
    return 0;
}
int host_memory_unmap_fixed(uintptr_t address, size_t size)
{
    return munmap((void *)address, size);
}

/* Query the DSO containing our own code. PIE/ASLR means that the image
 * cannot be located by fixed executable addresses as the x86 port did. */
struct image_lookup {
    uintptr_t code;
    struct host_span all;
    struct host_span writable;
    bool found;
};
static int find_android_image(struct dl_phdr_info *info, size_t size, void *context)
{
    (void)size;
    struct image_lookup *lookup = context;
    uintptr_t lowest = UINTPTR_MAX, highest = 0;
    uintptr_t writable_low = UINTPTR_MAX, writable_high = 0;
    bool contains_code = false;
    for (ElfW(Half) i = 0; i < info->dlpi_phnum; ++i) {
        const ElfW(Phdr) *phdr = &info->dlpi_phdr[i];
        if (phdr->p_type != PT_LOAD)
            continue;
        const uintptr_t begin = (uintptr_t)info->dlpi_addr + (uintptr_t)phdr->p_vaddr;
        if ((uintptr_t)phdr->p_memsz > UINTPTR_MAX - begin)
            continue;
        const uintptr_t end = begin + (uintptr_t)phdr->p_memsz;
        if (lookup->code >= begin && lookup->code < end)
            contains_code = true;
        if (begin < lowest) lowest = begin;
        if (end > highest) highest = end;
        if ((phdr->p_flags & PF_W) != 0) {
            if (begin < writable_low) writable_low = begin;
            if (end > writable_high) writable_high = end;
        }
    }
    if (!contains_code || lowest == UINTPTR_MAX)
        return 0;
    lookup->all = (struct host_span){lowest, highest};
    lookup->writable = writable_low == UINTPTR_MAX
        ? (struct host_span){0, 0}
        : (struct host_span){writable_low, writable_high};
    lookup->found = true;
    return 1;
}
static struct image_lookup current_image(void)
{
    struct image_lookup query = {.code = (uintptr_t)&host_image_whole};
    (void)dl_iterate_phdr(find_android_image, &query);
    return query;
}
struct host_span host_image_whole(void)
{
    return current_image().all;
}
struct host_span host_image_writable(void)
{
    return current_image().writable;
}
bool host_image_is_read_only(uintptr_t address)
{
    struct image_lookup query = current_image();
    if (!query.found || address < query.all.start || address >= query.all.end)
        return false;
    /* Conservative: an address in the image's writable range isn't ROM.
     * Treating a mixed-permission page as read-only could corrupt saves. */
    return address < query.writable.start || address >= query.writable.end;
}
int host_image_main_stack(struct host_span *out)
{
    if (out == NULL)
        return -1;
    pthread_attr_t attributes;
    if (pthread_getattr_np(pthread_self(), &attributes) != 0)
        return -1;
    void *start = NULL;
    size_t size = 0;
    int result = pthread_attr_getstack(&attributes, &start, &size);
    (void)pthread_attr_destroy(&attributes);
    if (result != 0 || size == 0 || size > UINTPTR_MAX - (uintptr_t)start)
        return -1;
    *out = (struct host_span){(uintptr_t)start, (uintptr_t)start + size};
    return 0;
}
/* host_stack_run/host_stack_leave are in host_android_stack.S because
 * Bionic does not expose the glibc getcontext/swapcontext implementation.
 * The implementation preserves AAPCS64 callee-saved GP/FP registers. */
