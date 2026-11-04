cmake_minimum_required(VERSION 3.22.1)
project(brisk_android_transport LANGUAGES C CXX)

# JNI bridge. Never substitute a fake game or emulator for the game core.
add_library(briskandroid SHARED src/jni_bridge.cpp)
target_compile_features(briskandroid PRIVATE cxx_std_17)
target_compile_options(briskandroid PRIVATE -Wall -Wextra -Werror)
target_include_directories(briskandroid PRIVATE include)
target_link_libraries(briskandroid PRIVATE dl log)

# Compile the genuine game ABI adapter for every Android target. This OBJECT
# library is not itself a runnable game or an installable libbriskgame.so.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../tools/brisk-native-source.json" SOURCE_PIN)
string(JSON BRISK_SOURCE_COMMIT GET "${SOURCE_PIN}" brisk_commit)
if(NOT BRISK_SOURCE_COMMIT MATCHES "^[0-9a-f]+$")
  message(FATAL_ERROR "Invalid pinned Brisk source SHA")
endif()
string(LENGTH "${BRISK_SOURCE_COMMIT}" BRISK_COMMIT_LENGTH)
if(NOT BRISK_COMMIT_LENGTH EQUAL 40)
  message(FATAL_ERROR "Expected a complete pinned Brisk source SHA")
endif()
add_library(briskgameadapter OBJECT src/game_core_adapter.c)
target_compile_features(briskgameadapter PRIVATE c_std_17)
target_compile_options(briskgameadapter PRIVATE -Wall -Wextra -Werror)
target_include_directories(briskgameadapter PRIVATE include)
target_compile_definitions(briskgameadapter PRIVATE BRISK_SOURCE_COMMIT="${BRISK_SOURCE_COMMIT}")
set_target_properties(briskgameadapter PROPERTIES POSITION_INDEPENDENT_CODE ON)

# Full engine integration is strict: libbriskgame.so can only be built from
# a complete Android ARM64 archive of the pinned C source. The archive is
# supplied by a separate NDK game build; JNI-only APK builds remain transport
# only and explicitly report that the game is unavailable.
set(BRISK_NATIVE_ANDROID_ARCHIVE "" CACHE FILEPATH "Complete Android ARM64 game archive")
set(BRISK_ANDROID_SDL2_SOURCE "" CACHE PATH "SDL 2.30.12 Android source directory")
set(BRISK_ANDROID_SDL2_LIBRARY "" CACHE FILEPATH "SDL2 Android ARM64 shared library")
if(BRISK_NATIVE_ANDROID_ARCHIVE)
  if(NOT ANDROID OR NOT ANDROID_ABI STREQUAL "arm64-v8a")
    message(FATAL_ERROR "The native Brisk game archive is supported only with Android arm64-v8a")
  endif()
  if(NOT EXISTS "${BRISK_NATIVE_ANDROID_ARCHIVE}")
    message(FATAL_ERROR "Complete Android game archive does not exist: ${BRISK_NATIVE_ANDROID_ARCHIVE}")
  endif()
  if(BRISK_ANDROID_SDL2_SOURCE AND BRISK_ANDROID_SDL2_LIBRARY)
    message(FATAL_ERROR "Choose either the SDL2 source tree or an SDL2 shared library, not both")
  endif()
  if(BRISK_ANDROID_SDL2_SOURCE)
    if(NOT EXISTS "${BRISK_ANDROID_SDL2_SOURCE}/CMakeLists.txt")
      message(FATAL_ERROR "SDL2 source directory must contain CMakeLists.txt")
    endif()
    set(SDL_SHARED ON CACHE BOOL "" FORCE)
    set(SDL_STATIC OFF CACHE BOOL "" FORCE)
    set(SDL_TEST OFF CACHE BOOL "" FORCE)
    add_subdirectory("${BRISK_ANDROID_SDL2_SOURCE}" "${CMAKE_CURRENT_BINARY_DIR}/sdl2" EXCLUDE_FROM_ALL)
    if(TARGET SDL2::SDL2)
      set(BRISK_SDL2_TARGET SDL2::SDL2)
    elseif(TARGET SDL2)
      set(BRISK_SDL2_TARGET SDL2)
    else()
      message(FATAL_ERROR "SDL2 source did not create a linkable Android SDL2 target")
    endif()
  elseif(BRISK_ANDROID_SDL2_LIBRARY)
    if(NOT EXISTS "${BRISK_ANDROID_SDL2_LIBRARY}")
      message(FATAL_ERROR "SDL2 Android library does not exist")
    endif()
    add_library(brisk_sdl2 SHARED IMPORTED)
    set_target_properties(brisk_sdl2 PROPERTIES
      IMPORTED_LOCATION "${BRISK_ANDROID_SDL2_LIBRARY}")
    set(BRISK_SDL2_TARGET brisk_sdl2)
  else()
    message(FATAL_ERROR
      "A full Android game build also needs SDL2: configure BRISK_ANDROID_SDL2_SOURCE or BRISK_ANDROID_SDL2_LIBRARY")
  endif()

  # The adapter references brisk_android_game_main, which MUST be supplied
  # by the genuine compiled game. All other references must resolve too;
  # static archives with placeholders or missing gameplay fail the final
  # ELF link rather than generating an apparently playable APK.
  add_library(briskgame SHARED $<TARGET_OBJECTS:briskgameadapter>)
  target_link_options(briskgame PRIVATE
    "-Wl,-z,defs"
    "-Wl,--no-undefined"
    "-Wl,--no-allow-shlib-undefined")
  target_link_libraries(briskgame PRIVATE
    "-Wl,--whole-archive"
    "${BRISK_NATIVE_ANDROID_ARCHIVE}"
    "-Wl,--no-whole-archive"
    "${BRISK_SDL2_TARGET}" log m dl android)
  set_target_properties(briskgame PROPERTIES OUTPUT_NAME "briskgame")
endif()
