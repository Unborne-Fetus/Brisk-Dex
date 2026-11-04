#include <jni.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include <atomic>
#include <string>
#include "brisk_android_core.h"

namespace {
constexpr size_t kBytes=BRISK_ANDROID_PIXELS*2;
pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
uint8_t frame[kBytes]={};
uint64_t frame_sequence=0;
void *engine_library=nullptr;
const brisk_android_core_v1 *engine=nullptr;
std::atomic<bool> running{false};

void receiveFrame(const uint16_t *pixels,void *) {
  if(!pixels)return;
  pthread_mutex_lock(&lock);
  memcpy(frame,pixels,kBytes);
  ++frame_sequence;
  pthread_mutex_unlock(&lock);
}
std::string probe(const char *commit) {
  if(!commit || strlen(commit)!=40)return "The pinned Brisk source revision is missing.";
  if(running.load())return {};
  if(!engine_library){
    engine_library=dlopen("libbriskgame.so",RTLD_NOW|RTLD_LOCAL);
    if(!engine_library){
      const char *reason=dlerror();
      return std::string("Android Brisk Emerald game engine is not packaged: ")+(reason?reason:"unknown error");
    }
  }
  const auto entry=reinterpret_cast<brisk_android_core_entry>(dlsym(engine_library,"brisk_android_core_v1_entry"));
  if(!entry)return "The native game has no compatible Android interface.";
  const auto *candidate=entry();
  if(!candidate || candidate->abi_version!=BRISK_ANDROID_CORE_ABI ||
     !candidate->profile || strcmp(candidate->profile,"brisk") ||
     !candidate->source_commit || strcmp(candidate->source_commit,commit) ||
     !candidate->run || !candidate->stop || !candidate->input || !candidate->configure)
    return "The game library does not match the Windows Brisk source revision and Android engine API.";
  engine=candidate;
  return {};
}
}
extern "C" JNIEXPORT jstring JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeProbe(JNIEnv *env,jclass,jstring commit) {
  if(!commit)return env->NewStringUTF("Missing Brisk source revision.");
  const char *expected=env->GetStringUTFChars(commit,nullptr);
  if(!expected)return env->NewStringUTF("Cannot read Brisk source revision.");
  pthread_mutex_lock(&lock);
  auto result=probe(expected);
  pthread_mutex_unlock(&lock);
  env->ReleaseStringUTFChars(commit,expected);
  return env->NewStringUTF(result.c_str());
}
extern "C" JNIEXPORT jint JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeRun(JNIEnv *env,jclass,jstring save_dir){
  if(!save_dir)return -1;
  const char *dir=env->GetStringUTFChars(save_dir,nullptr);
  if(!dir)return -1;
  pthread_mutex_lock(&lock);
  const auto *active=engine;
  if(!active || running.exchange(true)){
    pthread_mutex_unlock(&lock);
    env->ReleaseStringUTFChars(save_dir,dir);
    return -2;
  }
  frame_sequence=0;
  pthread_mutex_unlock(&lock);
  const int status=active->run(dir,receiveFrame,nullptr);
  pthread_mutex_lock(&lock);
  running.store(false);
  pthread_mutex_unlock(&lock);
  env->ReleaseStringUTFChars(save_dir,dir);
  return status;
}
extern "C" JNIEXPORT void JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeStop(JNIEnv *,jclass){
  const auto *active=engine;
  if(running.load() && active){active->input(0);active->stop();}
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeRunning(JNIEnv *,jclass){
  return running.load()?JNI_TRUE:JNI_FALSE;
}
extern "C" JNIEXPORT void JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeKeys(JNIEnv *,jclass,jint keys){
  const auto *active=engine;
  if(active && running.load() && keys>=0 && keys<=1023)active->input(static_cast<uint16_t>(keys));
}
extern "C" JNIEXPORT jint JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeConfigure(JNIEnv *,jclass,jint speed,jboolean paused,jboolean muted){
  const auto *active=engine;
  if(!active || speed<0 || speed>4)return -1;
  return active->configure(speed,paused?1:0,muted?1:0);
}
// 8-byte little-endian sequence number + 76800 bytes of BGR555 pixels.
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_briskemerald_briskdex_BriskNativeGamePlugin_nativeFrame(JNIEnv *env,jclass,jlong since){
  pthread_mutex_lock(&lock);
  if(!running.load() || !frame_sequence || static_cast<uint64_t>(since)==frame_sequence){
    pthread_mutex_unlock(&lock);
    return nullptr;
  }
  uint8_t packet[8+kBytes];
  const uint64_t seq=frame_sequence;
  for(int i=0;i<8;i++)packet[i]=static_cast<uint8_t>(seq>>(8*i));
  memcpy(packet+8,frame,kBytes);
  pthread_mutex_unlock(&lock);
  jbyteArray bytes=env->NewByteArray(static_cast<jsize>(sizeof(packet)));
  if(bytes)env->SetByteArrayRegion(bytes,0,static_cast<jsize>(sizeof(packet)),reinterpret_cast<jbyte*>(packet));
  return bytes;
}
