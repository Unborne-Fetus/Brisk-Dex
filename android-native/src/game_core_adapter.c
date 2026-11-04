/* Android native ABI adapter for the real Brisk Emerald game C sources.
 * A full compiled game archive is REQUIRED; this is not a playable stub. */
#include "brisk_android_core.h"
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#ifndef BRISK_SOURCE_COMMIT
#error Missing pinned Brisk source commit
#endif
/* The original platform/main.c main() must be renamed to this at compile time. */
extern int brisk_android_game_main(int argc, char **argv);
static atomic_bool active = ATOMIC_VAR_INIT(false);
static atomic_bool quit = ATOMIC_VAR_INIT(false);
static atomic_uint keys = ATOMIC_VAR_INIT(0u);
static atomic_uint options = ATOMIC_VAR_INIT(1u);
static brisk_frame_sink sink;
static void *sink_context;

void brisk_android_deliver_frame(const uint16_t *frame)
{
    if (atomic_load_explicit(&active, memory_order_acquire) && frame && sink)
        sink(frame, sink_context);
}
uint16_t brisk_android_keymask(void)
{
    return (uint16_t)(atomic_load_explicit(&keys, memory_order_relaxed) & 1023u);
}
unsigned brisk_android_stream_speed(void)
{
    return atomic_load_explicit(&options, memory_order_relaxed) & 7u;
}
bool brisk_android_is_paused(void)
{
    return (atomic_load_explicit(&options, memory_order_relaxed) & 8u) != 0;
}
bool brisk_android_is_muted(void)
{
    return (atomic_load_explicit(&options, memory_order_relaxed) & 16u) != 0;
}
bool brisk_android_stop_requested(void)
{
    return atomic_load_explicit(&quit, memory_order_acquire);
}
/* 0 = FRAME_STEP_CONTINUE; 1 = FRAME_STEP_STOP. Called on game's frame thread. */
int brisk_android_frame_step(void *context)
{
    (void)context;
    const struct timespec nap = {.tv_sec = 0, .tv_nsec = 12000000};
    while (brisk_android_is_paused()
           && !atomic_load_explicit(&quit, memory_order_acquire))
        nanosleep(&nap, NULL);
    return atomic_load_explicit(&quit, memory_order_acquire) ? 1 : 0;
}
static int core_run(const char *root, brisk_frame_sink deliver, void *context)
{
    if (!root || !*root || !deliver) return -1;
    if (atomic_exchange_explicit(&active, true, memory_order_acq_rel)) return -2;
    /* A stop between Java scheduling and the C entry point must not be lost.
     * Keep configuration set before launch; the UI commonly sends it while
     * the background game thread is still being scheduled. */
    const bool canceled = atomic_exchange_explicit(&quit, false, memory_order_acq_rel);
    if (canceled) {
        atomic_store_explicit(&active, false, memory_order_release);
        return 0;
    }
    atomic_store_explicit(&keys, 0, memory_order_release);
    sink = deliver;
    sink_context = context;
    char *argv[] = {(char *)"pokeemerald-native", (char *)"--headless",
                    (char *)"--data-dir", (char *)root, NULL};
    const int result = brisk_android_game_main(4, argv);
    sink = NULL;
    sink_context = NULL;
    atomic_store_explicit(&active, false, memory_order_release);
    return result;
}
static void core_stop(void)
{
    atomic_store_explicit(&quit, true, memory_order_release);
}
static void core_input(uint16_t mask)
{
    atomic_store_explicit(&keys, mask & 1023u, memory_order_release);
}
static int core_configure(int speed, int paused, int muted)
{
    if (speed < 0 || speed > 4 || (paused != 0 && paused != 1)
        || (muted != 0 && muted != 1)) return -1;
    atomic_store_explicit(&options, (unsigned)speed | ((unsigned)paused << 3)
                           | ((unsigned)muted << 4), memory_order_release);
    return 0;
}
static const brisk_android_core_v1 core_api = {
    .abi_version = BRISK_ANDROID_CORE_ABI,
    .source_commit = BRISK_SOURCE_COMMIT,
    .profile = "brisk",
    .run = core_run,
    .stop = core_stop,
    .input = core_input,
    .configure = core_configure
};
__attribute__((visibility("default")))
const brisk_android_core_v1 *brisk_android_core_v1_entry(void)
{
    return &core_api;
}
