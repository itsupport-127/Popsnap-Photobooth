// hanya untuk uji sintaks di Linux — bukan dipakai saat build sungguhan
#pragma once
#include <unistd.h>
#include <cstdint>
#define __stdcall
#define MAX_PATH 260
typedef void* HMODULE;
inline void Sleep(unsigned ms){usleep(ms*1000);}
inline unsigned GetModuleFileNameA(HMODULE,char* b,unsigned){b[0]=0;return 0;}
inline void SetDllDirectoryA(const char*){}
inline HMODULE LoadLibraryA(const char*){return nullptr;}
inline void* GetProcAddress(HMODULE,const char*){return nullptr;}
