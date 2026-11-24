/* Relocatable Android game storage, separate from platform and JNI state.
 * Do not place sections at fixed GBA addresses in an ASLR-loaded .so.
 * crt0 snapshots initial values and clears game BSS on a soft reset.
 * Only game object .data/.bss are renamed by android_assemble.py;
 * RELRO, the packed pointer table, host state and script bytecode stay out.
 */
SECTIONS
{
    .brisk_tests : {
        HIDDEN(__start_tests = .);
        KEEP(*(.tests))
        HIDDEN(__stop_tests = .);
    }
    .brisk_game_data : {
        HIDDEN(game_data_start = .);
        *(.brisk_game_data .brisk_game_data.*)
        *(.iwram .iwram.*)
        HIDDEN(game_data_end = .);
    }
    .brisk_ewram_init : {
        HIDDEN(gba_linked_ewram_init_start = .);
        *(.ewram .ewram.*)
        HIDDEN(gba_linked_ewram_init_end = .);
    }
}
INSERT BEFORE .data;

SECTIONS
{
    .brisk_game_bss (NOLOAD) : {
        HIDDEN(game_bss_start = .);
        *(.brisk_game_bss .brisk_game_bss.*)
        *(.sbss .sbss.*)
        HIDDEN(game_bss_objects_end = .);
        *(common_data)
        HIDDEN(game_bss_end = .);
    }
}
INSERT BEFORE .bss;

HIDDEN(gba_game_objects_linked = ABSOLUTE(1));
ASSERT(game_bss_objects_end > game_bss_start, "Brisk game reset BSS is missing");
ASSERT(gba_linked_ewram_init_end - gba_linked_ewram_init_start <= 0x1000,
       "Brisk game EWRAM init exceeds crt0 snapshot capacity");
