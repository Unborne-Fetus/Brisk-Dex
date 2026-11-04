/*
 * AArch64 switch to the dedicated battle/test call stack.
 * Bionic intentionally has no glibc swapcontext; preserve AAPCS64
 * callee-saved GP x19-x30 and FP d8-d15 explicitly.
 * This remains single-threaded and non-reentrant, as the desktop host is.
 */
#if !defined(__aarch64__)
#error "AArch64 host stack assembly compiled for a different architecture"
#endif
.text
.p2align 2
.hidden brisk_android_saved_stack
.bss
.p2align 3
brisk_android_saved_stack:
    .xword 0
.text
.p2align 2
.global host_stack_run
.type host_stack_run, %function
host_stack_run:
    // Incoming args: stack, size, entry, context.
    // Basic parameter validation must happen BEFORE touching the switch.
    cbz x0, .Lbad_stack
    cbz x1, .Lbad_stack
    cbz x2, .Lbad_stack
    stp x29, x30, [sp, #-16]!
    stp x19, x20, [sp, #-16]!
    stp x21, x22, [sp, #-16]!
    stp x23, x24, [sp, #-16]!
    stp x25, x26, [sp, #-16]!
    stp x27, x28, [sp, #-16]!
    stp d8, d9, [sp, #-16]!
    stp d10, d11, [sp, #-16]!
    stp d12, d13, [sp, #-16]!
    stp d14, d15, [sp, #-16]!
    adrp x9, brisk_android_saved_stack
    add x9, x9, :lo12:brisk_android_saved_stack
    ldr x10, [x9]
    cbnz x10, .Lalready_switched
    mov x11, sp
    str x11, [x9]
    add x10, x0, x1
    and x10, x10, #0xfffffffffffffff0
    mov sp, x10
    mov x0, x3
    blr x2
    b .Lrestore_stack

.global host_stack_leave
.type host_stack_leave, %function
host_stack_leave:
    adrp x9, brisk_android_saved_stack
    add x9, x9, :lo12:brisk_android_saved_stack
    ldr x10, [x9]
    cbz x10, .Lleave_without_stack
    mov sp, x10
    b .Lrestore_stack

.Lrestore_stack:
    adrp x9, brisk_android_saved_stack
    add x9, x9, :lo12:brisk_android_saved_stack
    str xzr, [x9]
    ldp d14, d15, [sp], #16
    ldp d12, d13, [sp], #16
    ldp d10, d11, [sp], #16
    ldp d8, d9, [sp], #16
    ldp x27, x28, [sp], #16
    ldp x25, x26, [sp], #16
    ldp x23, x24, [sp], #16
    ldp x21, x22, [sp], #16
    ldp x19, x20, [sp], #16
    ldp x29, x30, [sp], #16
    mov w0, #0
    ret
.Lalready_switched:
    ldp d14, d15, [sp], #16
    ldp d12, d13, [sp], #16
    ldp d10, d11, [sp], #16
    ldp d8, d9, [sp], #16
    ldp x27, x28, [sp], #16
    ldp x25, x26, [sp], #16
    ldp x23, x24, [sp], #16
    ldp x21, x22, [sp], #16
    ldp x19, x20, [sp], #16
    ldp x29, x30, [sp], #16
.Lbad_stack:
    mov w0, #-1
    ret
.Lleave_without_stack:
    brk #0

.size host_stack_run, . - host_stack_run
.size host_stack_leave, . - host_stack_leave
.section .note.GNU-stack,"",%progbits
