#ifndef BRISK_ANDROID_CORE_H
#define BRISK_ANDROID_CORE_H
/* Stable ABI supplied by a real Android build of the pinned native game. */
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define BRISK_ANDROID_CORE_ABI 1u
#define BRISK_ANDROID_PIXELS (240u * 160u)
typedef void (*brisk_frame_sink)(const uint16_t *bgr555, void *context);
typedef struct {
    uint32_t abi_version;
    const char *source_commit; /* the pinned Brisk Emerald source commit */
    const char *profile;       /* "brisk" */
    int (*run)(const char *save_root, brisk_frame_sink deliver, void *context);
    void (*stop)(void);
    void (*input)(uint16_t ten_bit_mask);
    int (*configure)(int speed, int paused, int muted);
} brisk_android_core_v1;
typedef const brisk_android_core_v1 *(*brisk_android_core_entry)(void);
/* Expected exported symbol from the actual libbriskgame.so (not provided yet). */
const brisk_android_core_v1 *brisk_android_core_v1_entry(void);
#ifdef __cplusplus
}
#endif
#endif
