// ============================================================================
// popsnap_canon_bridge — program perantara Canon EDSDK untuk POPSNAP (dibuat 32-bit karena EDSDK.dll Canon 32-bit).
//
// Tujuan: live view LANCAR. Frame JPEG dari kamera dikirim langsung lewat pipa (stdout) begitu tersedia — tanpa menulis
// file ke disk dan tanpa polling. Foto hasil jepret juga dikirim lewat pipa (tanpa file perantara).
//
// Protokol (semua lewat stdout, biner):  [1 byte jenis]['T' teks | 'F' frame live view | 'P' foto][4 byte panjang little-endian][isi]
// Perintah (stdin, satu baris, diakhiri \n):
//   CONNECT          sambung ke kamera Canon pertama
//   LIVEVIEW_START   nyalakan live view (frame 'F' mengalir terus)
//   LIVEVIEW_STOP    matikan live view
//   LV_BOOST <n>     "Canon Auto Exposure": selama live view, terangkan eksposur kamera n stop (0 = mati, maks 6). Hanya mode Manual.
//                    Setelan asli kamera dikembalikan otomatis saat live view berhenti / sebelum jepret / saat keluar.
//   CAM_INFO         baca setelan kamera: balasan teks CAMINFO|{json} (mode, ISO, shutter, aperture, white balance + daftar pilihan)
//   CAM_SET <iso|av|tv|wb> <kode>   ubah satu setelan (kode = nilai dari CAMINFO). Balasan CAMSET_OK|<prop> atau CAMSET_FAILED|<prop>|<sebab>, lalu CAMINFO baru.
//   CAPTURE          jepret -> 'P' (JPEG) lalu teks CAPTURE_OK|<byte>, atau CAPTURE_FAILED|<sebab>
//   DISCONNECT       lepas kamera
//   QUIT             keluar
// Teks ('T') yang dikirim: READY|..., CONNECTED|<nama>, DISCONNECTED, LIVEVIEW_STARTED, LIVEVIEW_STOPPED,
//   CAPTURE_OK|n, CAPTURE_FAILED|sebab, ERROR|pesan, FPS|n (tiap detik saat live view)
//
// Build (x86!):  buka "x86 Native Tools Command Prompt for VS 2022", jalankan build.bat di folder ini.
// EDSDK.dll & EdsImage.dll (dari SDK Canon Anda) harus berada satu folder dengan exe ini.
// Seluruh fungsi SDK dimuat dinamis dari EDSDK.dll (tanpa header/lib SDK); nilai konstanta dari dokumentasi EDSDK.
// ============================================================================
#ifdef POPSNAP_TEST
#include "test/shim_windows.h"
#else
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#endif
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>
#include <deque>
#include <mutex>
#include <thread>
#include <chrono>

#ifndef EDSAPI
#define EDSAPI __stdcall
#endif

typedef uint32_t U32;
typedef int32_t I32;
typedef uint64_t U64;
typedef void* Ref;

struct DeviceInfo { char port[256]; char desc[256]; U32 subType; U32 reserved; };
struct DirItemInfo { U64 size; I32 isFolder; U32 groupID; U32 option; char fileName[256]; U32 format; U32 dateTime; };
struct Capacity { I32 freeClusters; I32 bytesPerSector; I32 reset; };

typedef U32 (EDSAPI *ObjHandler)(U32 event, Ref object, void* context);
typedef U32 (EDSAPI *StateHandler)(U32 event, U32 param, void* context);

#define FN(ret, name, args) typedef ret (EDSAPI *name##_t) args; static name##_t name = nullptr;
FN(U32, EdsInitializeSDK, (void))
FN(U32, EdsTerminateSDK, (void))
FN(U32, EdsGetCameraList, (Ref*))
FN(U32, EdsGetChildCount, (Ref, U32*))
FN(U32, EdsGetChildAtIndex, (Ref, I32, Ref*))
FN(U32, EdsGetDeviceInfo, (Ref, DeviceInfo*))
FN(U32, EdsOpenSession, (Ref))
FN(U32, EdsCloseSession, (Ref))
FN(U32, EdsRelease, (Ref))
FN(U32, EdsSetPropertyData, (Ref, U32, I32, U32, const void*))
FN(U32, EdsGetPropertyData, (Ref, U32, I32, U32, void*))
FN(U32, EdsSendCommand, (Ref, U32, I32))
FN(U32, EdsSetCapacity, (Ref, Capacity))
FN(U32, EdsSetObjectEventHandler, (Ref, U32, ObjHandler, void*))
FN(U32, EdsSetCameraStateEventHandler, (Ref, U32, StateHandler, void*))
FN(U32, EdsCreateMemoryStream, (U64, Ref*))
FN(U32, EdsCreateEvfImageRef, (Ref, Ref*))
FN(U32, EdsDownloadEvfImage, (Ref, Ref))
FN(U32, EdsGetPointer, (Ref, void**))
FN(U32, EdsGetLength, (Ref, U64*))
FN(U32, EdsGetDirectoryItemInfo, (Ref, DirItemInfo*))
FN(U32, EdsDownload, (Ref, U64, Ref))
FN(U32, EdsDownloadComplete, (Ref))
FN(U32, EdsDownloadCancel, (Ref))
FN(U32, EdsGetEvent, (void))
struct PropDesc { I32 form; I32 access; I32 num; I32 vals[128]; };
FN(U32, EdsGetPropertyDesc, (Ref, U32, PropDesc*))

// konstanta EDSDK
static const U32 PROP_AE_MODE = 0x00000400, PROP_ISO = 0x00000402, PROP_AV = 0x00000405, PROP_TV = 0x00000406, PROP_WB = 0x00000106, AE_MANUAL = 3;
static const U32 PROP_SAVETO = 0x0000000b, SAVETO_HOST = 2;
static const U32 PROP_EVF_OUTPUT = 0x00000500, PROP_EVF_MODE = 0x00000501, EVF_OUT_PC = 2;
static const U32 CMD_TAKE_PICTURE = 0x00000000, CMD_PRESS_SHUTTER = 0x00000004, SHUTTER_COMPLETELY_NONAF = 0x00010003, SHUTTER_OFF = 0;
static const U32 OBJ_EVENT_ALL = 0x00000200, OBJ_DIRITEM_REQUEST_TRANSFER = 0x00000208;
static const U32 STATE_EVENT_ALL = 0x00000300, STATE_SHUTDOWN = 0x00000301;
static const U32 ERR_DEVICE_BUSY = 0x00000081, ERR_DEVICE_INVALID = 0x00000080, ERR_COMM_DISCONNECTED = 0x000000C1, ERR_OBJECT_NOTREADY = 0x0000A102, ERR_AF_NG = 0x00008D01;

static void sleepMs(unsigned ms) { Sleep(ms); }
static U64 nowMs() { return (U64)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

// ---------- keluaran biner ----------
static void packet(char type, const void* data, uint32_t len) {
  unsigned char h[5] = { (unsigned char)type, (unsigned char)(len & 255), (unsigned char)((len >> 8) & 255), (unsigned char)((len >> 16) & 255), (unsigned char)((len >> 24) & 255) };
  fwrite(h, 1, 5, stdout);
  if (len) fwrite(data, 1, len, stdout);
  fflush(stdout);
}
static void say(const std::string& s) { packet('T', s.data(), (uint32_t)s.size()); }
static std::string hex(U32 v) { char b[16]; snprintf(b, sizeof b, "0x%08X", v); return b; }

// ---------- perintah dari stdin (thread terpisah) ----------
static std::mutex g_cmdMu;
static std::deque<std::string> g_cmds;
static void stdinThread() {
  char buf[512];
  while (fgets(buf, sizeof buf, stdin)) {
    std::string s(buf);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ')) s.pop_back();
    if (s.empty()) continue;
    std::lock_guard<std::mutex> lk(g_cmdMu);
    g_cmds.push_back(s);
  }
  std::lock_guard<std::mutex> lk(g_cmdMu);
  g_cmds.push_back("QUIT"); // stdin tertutup = POPSNAP berhenti
}

// ---------- status kamera ----------
static bool g_sdkReady = false, g_connected = false, g_evf = false, g_running = true;
static Ref g_cam = nullptr, g_evfStream = nullptr, g_evfImage = nullptr;
static std::vector<Ref> g_pendingItems;
static bool g_shutdownSeen = false;

static U32 EDSAPI onObject(U32 ev, Ref obj, void*) {
  if (ev == OBJ_DIRITEM_REQUEST_TRANSFER && obj) g_pendingItems.push_back(obj); // diunduh di loop utama, lalu di-Release di sana
  else if (obj && (ev == 0x00000204 /*DirItemCreated*/ || ev == 0x00000205 /*DirItemRemoved*/)) EdsRelease(obj);
  return 0;
}
static U32 EDSAPI onState(U32 ev, U32, void*) { if (ev == STATE_SHUTDOWN) g_shutdownSeen = true; return 0; }

static bool loadSdk(std::string& why) {
  char path[MAX_PATH]; GetModuleFileNameA(nullptr, path, MAX_PATH);
  std::string dir(path); size_t p = dir.find_last_of("\\/"); dir = p == std::string::npos ? "." : dir.substr(0, p);
  SetDllDirectoryA(dir.c_str());
  HMODULE h = LoadLibraryA((dir + "\\EDSDK.dll").c_str());
  if (!h) h = LoadLibraryA("EDSDK.dll");
  if (!h) { why = "EDSDK.dll tidak bisa dimuat (taruh EDSDK.dll & EdsImage.dll 32-bit satu folder dengan program ini)"; return false; }
#define LOAD(n) n = (n##_t)GetProcAddress(h, #n); if (!n) { why = std::string("EDSDK.dll tidak punya fungsi ") + #n; return false; }
  LOAD(EdsInitializeSDK) LOAD(EdsTerminateSDK) LOAD(EdsGetCameraList) LOAD(EdsGetChildCount) LOAD(EdsGetChildAtIndex) LOAD(EdsGetDeviceInfo)
  LOAD(EdsOpenSession) LOAD(EdsCloseSession) LOAD(EdsRelease) LOAD(EdsSetPropertyData) LOAD(EdsGetPropertyData) LOAD(EdsSendCommand)
  LOAD(EdsSetCapacity) LOAD(EdsSetObjectEventHandler) LOAD(EdsSetCameraStateEventHandler) LOAD(EdsCreateMemoryStream) LOAD(EdsCreateEvfImageRef)
  LOAD(EdsDownloadEvfImage) LOAD(EdsGetPointer) LOAD(EdsGetLength) LOAD(EdsGetDirectoryItemInfo) LOAD(EdsDownload) LOAD(EdsDownloadComplete)
  LOAD(EdsDownloadCancel) LOAD(EdsGetEvent) LOAD(EdsGetPropertyDesc)
  return true;
}

// ---------- "Canon Auto Exposure": eksposur live view diterangkan sementara ----------
// Kamera Canon entry-level (mis. 1100D) menampilkan live view sesuai eksposur FOTO. Setelan untuk flash (shutter cepat, ISO rendah) membuat
// live view gelap. Solusi: selama live view, ISO dinaikkan (lalu shutter diperlambat) beberapa stop; sebelum jepret semuanya dikembalikan.
// Kode nilai Canon: tiap 8 langkah = 1 stop (ISO 0x48=100, 0x50=200, ... 0x78=6400; Tv 0x68=1/60, 0x60=1/30 ...).
static int g_boostStops = 0;           // permintaan (dari admin)
static bool g_boosted = false;         // sedang diterangkan?
static U32 g_origIso = 0, g_origTv = 0;
static std::string g_dir = ".";
static std::string bakPath() { return g_dir + "\\popsnap_lv_exposure.bak"; }
static void bakWrite() { FILE* f = fopen(bakPath().c_str(), "w"); if (f) { fprintf(f, "%u %u\n", g_origIso, g_origTv); fclose(f); } }
static void bakClear() { remove(bakPath().c_str()); }
static bool setProp(U32 id, U32 v) { return EdsSetPropertyData(g_cam, id, 0, 4, &v) == 0; }
static bool getProp(U32 id, U32& v) { v = 0; return EdsGetPropertyData(g_cam, id, 0, 4, &v) == 0; }
static bool setVerified(U32 id, U32 want) { // set lalu baca ulang (kamera kadang butuh waktu)
  for (int i = 0; i < 6; i++) { setProp(id, want); EdsGetEvent(); sleepMs(60); U32 cur; if (getProp(id, cur) && cur == want) return true; sleepMs(80); }
  return false;
}
static void boostApply() {
  if (g_boosted || g_boostStops <= 0 || !g_connected || !g_cam) return;
  U32 ae = 0; if (!getProp(PROP_AE_MODE, ae) || ae != AE_MANUAL) return; // hanya Manual: mode lain biarkan kamera mengatur sendiri
  U32 iso = 0, tv = 0; if (!getProp(PROP_ISO, iso) || !getProp(PROP_TV, tv) || iso == 0 || iso == 0x00000000) return; // ISO Auto (0) / tak terbaca: lewati
  g_origIso = iso; g_origTv = tv; bakWrite(); g_boosted = true; // dicatat DULU: kalau program mati, setelan asli bisa dipulihkan
  int left = g_boostStops;
  // 1) naikkan ISO (maks 6400 = 0x78)
  U32 newIso = iso; while (left > 0 && newIso + 8 <= 0x78) { newIso += 8; left--; }
  if (newIso != iso && !setVerified(PROP_ISO, newIso)) { // nilai ditolak kamera: coba turun satu-satu
    U32 t = newIso; bool ok = false; while (t > iso + 7) { t -= 8; if (setVerified(PROP_ISO, t)) { ok = true; left += (int)((newIso - t) / 8); break; } }
    if (!ok) left += (int)((newIso - iso) / 8);
  }
  // 2) sisanya perlambat shutter (batas 1/30 = 0x60 supaya frame live view tetap lancar)
  U32 newTv = tv; while (left > 0 && newTv > 0x60 + 7 && newTv - 8 >= 0x60) { newTv -= 8; left--; }
  if (newTv != tv && newTv < tv) setVerified(PROP_TV, newTv);
  say("LV_BOOSTED|" + std::to_string(g_boostStops - left) + " stop");
}
// Kembalikan eksposur asli. true = pasti sudah kembali (atau memang tidak sedang diterangkan).
static bool boostRestore() {
  if (!g_boosted) return true;
  if (!g_connected || !g_cam) return false; // kamera lepas: file cadangan dipakai saat tersambung lagi
  bool ok = setVerified(PROP_ISO, g_origIso);
  bool ok2 = setVerified(PROP_TV, g_origTv);
  if (ok && ok2) { g_boosted = false; bakClear(); say("LV_RESTORED"); return true; }
  say("ERROR|Gagal mengembalikan eksposur kamera (ISO/Tv). Cek setelan kamera.");
  return false;
}
// Sisa dari sesi sebelumnya (program mati saat live view diterangkan)? Pulihkan saat kamera tersambung.
static void boostRecover() {
  FILE* f = fopen(bakPath().c_str(), "r"); if (!f) return;
  unsigned iso = 0, tv = 0; int n = fscanf(f, "%u %u", &iso, &tv); fclose(f);
  if (n == 2 && iso && tv) { g_origIso = iso; g_origTv = tv; g_boosted = true; boostRestore(); } else bakClear();
}

static void evfRelease() {
  if (g_evfImage) { EdsRelease(g_evfImage); g_evfImage = nullptr; }
  if (g_evfStream) { EdsRelease(g_evfStream); g_evfStream = nullptr; }
}
static bool evfStart() {
  if (!g_connected) { say("ERROR|Kamera belum tersambung"); return false; }
  if (g_evf) return true;
  U32 mode = 1; EdsSetPropertyData(g_cam, PROP_EVF_MODE, 0, 4, &mode); // beberapa kamera menolak -> abaikan
  U32 dev = 0; EdsGetPropertyData(g_cam, PROP_EVF_OUTPUT, 0, 4, &dev);
  dev |= EVF_OUT_PC;
  U32 err = EdsSetPropertyData(g_cam, PROP_EVF_OUTPUT, 0, 4, &dev);
  if (err) { say("ERROR|Live view gagal dinyalakan SDK=" + hex(err)); return false; }
  evfRelease();
  if (EdsCreateMemoryStream(0, &g_evfStream) || EdsCreateEvfImageRef(g_evfStream, &g_evfImage)) { evfRelease(); say("ERROR|Gagal menyiapkan buffer live view"); return false; }
  g_evf = true; say("LIVEVIEW_STARTED");
  boostApply(); // terangkan eksposur selama live view (jika diminta)
  return true;
}
static void evfStop(bool announce) {
  if (!g_evf) return;
  g_evf = false; evfRelease();
  boostRestore();
  if (g_connected && g_cam) { U32 dev = 0; EdsGetPropertyData(g_cam, PROP_EVF_OUTPUT, 0, 4, &dev); dev &= ~EVF_OUT_PC; EdsSetPropertyData(g_cam, PROP_EVF_OUTPUT, 0, 4, &dev); }
  if (announce) say("LIVEVIEW_STOPPED");
}

static void disconnect(bool announce) {
  evfStop(false);
  for (Ref r : g_pendingItems) EdsRelease(r);
  g_pendingItems.clear();
  if (g_cam) { EdsCloseSession(g_cam); EdsRelease(g_cam); g_cam = nullptr; }
  bool was = g_connected; g_connected = false;
  if (was && announce) say("DISCONNECTED");
}

static void connectCamera() {
  if (g_connected) { say("CONNECTED|(sudah tersambung)"); return; }
  if (!g_sdkReady) { say("ERROR|SDK belum siap"); return; }
  Ref list = nullptr; U32 err = EdsGetCameraList(&list);
  if (err || !list) { say("ERROR|EdsGetCameraList gagal " + hex(err)); return; }
  U32 n = 0; EdsGetChildCount(list, &n);
  if (n == 0) { EdsRelease(list); say("ERROR|NO_CAMERA Tidak ada kamera Canon. Nyalakan kamera, colok USB, tutup EOS Utility/aplikasi lain"); return; }
  Ref cam = nullptr; err = EdsGetChildAtIndex(list, 0, &cam); EdsRelease(list);
  if (err || !cam) { say("ERROR|Gagal mengambil kamera " + hex(err)); return; }
  DeviceInfo di; memset(&di, 0, sizeof di); EdsGetDeviceInfo(cam, &di);
  err = EdsOpenSession(cam);
  if (err) { EdsRelease(cam); say("ERROR|EdsOpenSession gagal " + hex(err) + (err == ERR_DEVICE_BUSY ? " (kamera dipakai aplikasi lain)" : "")); return; }
  g_cam = cam; g_connected = true; g_shutdownSeen = false;
  EdsSetObjectEventHandler(cam, OBJ_EVENT_ALL, onObject, nullptr);
  EdsSetCameraStateEventHandler(cam, STATE_EVENT_ALL, onState, nullptr);
  U32 saveTo = SAVETO_HOST; err = EdsSetPropertyData(cam, PROP_SAVETO, 0, 4, &saveTo); // foto dikirim ke PC, bukan kartu memori
  Capacity cap = { 0x7FFFFFFF, 0x1000, 1 }; EdsSetCapacity(cam, cap);
  if (err) say("ERROR|Gagal set SaveTo=Host " + hex(err));
  boostRecover();
  say(std::string("CONNECTED|") + di.desc);
}

// ---------- foto ----------
static bool endsWithJpeg(const char* name) {
  std::string s(name); for (auto& c : s) c = (char)tolower((unsigned char)c);
  return (s.size() > 4 && s.substr(s.size() - 4) == ".jpg") || (s.size() > 5 && s.substr(s.size() - 5) == ".jpeg");
}
// unduh satu item foto ke memori; true kalau berupa JPEG & terkirim
static bool downloadItem(Ref item, std::string& why) {
  DirItemInfo info; memset(&info, 0, sizeof info);
  U32 err = EdsGetDirectoryItemInfo(item, &info);
  if (err) { why = "GetDirectoryItemInfo " + hex(err); EdsDownloadCancel(item); EdsRelease(item); return false; }
  if (!endsWithJpeg(info.fileName)) { why = std::string("NOT_JPEG:") + info.fileName; EdsDownloadCancel(item); EdsRelease(item); return false; }
  Ref st = nullptr; err = EdsCreateMemoryStream(0, &st);
  if (err || !st) { why = "CreateMemoryStream " + hex(err); EdsDownloadCancel(item); EdsRelease(item); return false; }
  err = EdsDownload(item, info.size, st);
  if (!err) EdsDownloadComplete(item); else EdsDownloadCancel(item);
  EdsRelease(item);
  if (err) { EdsRelease(st); why = "Download " + hex(err); return false; }
  void* ptr = nullptr; U64 len = 0; EdsGetPointer(st, &ptr); EdsGetLength(st, &len);
  bool ok = ptr && len > 500 && ((unsigned char*)ptr)[0] == 0xFF && ((unsigned char*)ptr)[1] == 0xD8;
  if (ok) { packet('P', ptr, (uint32_t)len); say("CAPTURE_OK|" + std::to_string((unsigned long long)len)); }
  else why = "Isi foto bukan JPEG";
  EdsRelease(st);
  return ok;
}

static void capture() {
  if (!g_connected) { say("CAPTURE_FAILED|NO_CAMERA"); return; }
  bool wasEvf = g_evf;
  if (wasEvf) { evfStop(false); sleepMs(300); } // kamera lama (mis. 1100D) menolak jepret saat live view menyala (evfStop juga mengembalikan eksposur asli)
  if (g_boosted && !boostRestore()) { say("CAPTURE_FAILED|EKSPOSUR_BELUM_KEMBALI setelan ISO/Tv kamera belum kembali, jepret dibatalkan supaya foto tidak terlalu terang"); if (wasEvf) evfStart(); return; }
  for (Ref r : g_pendingItems) EdsRelease(r);
  g_pendingItems.clear();
  U32 err = 0;
  for (int i = 0; i < 6; i++) {
    err = EdsSendCommand(g_cam, CMD_TAKE_PICTURE, 0);
    if (err == ERR_AF_NG) { // fokus gagal: tekan rana tanpa AF
      err = EdsSendCommand(g_cam, CMD_PRESS_SHUTTER, (I32)SHUTTER_COMPLETELY_NONAF);
      EdsSendCommand(g_cam, CMD_PRESS_SHUTTER, (I32)SHUTTER_OFF);
    }
    if (err != ERR_DEVICE_BUSY && err != ERR_OBJECT_NOTREADY) break;
    EdsGetEvent(); sleepMs(200);
  }
  std::string why;
  bool done = false;
  if (err) why = "TakePicture " + hex(err);
  else {
    U64 t0 = nowMs();
    while (nowMs() - t0 < 25000 && !done && g_running) {
      EdsGetEvent();
      while (!g_pendingItems.empty() && !done) {
        Ref it = g_pendingItems.front(); g_pendingItems.erase(g_pendingItems.begin());
        std::string w; if (downloadItem(it, w)) done = true; else why = w; // RAW+JPEG: item RAW dilewati, tunggu JPEG-nya
      }
      if (!done) sleepMs(15);
    }
    if (!done && why.empty()) why = "TIMEOUT foto tidak datang dari kamera";
  }
  if (!done) say("CAPTURE_FAILED|" + why);
  if (wasEvf) { sleepMs(200); evfStart(); }
}

// ---------- live view ----------
static U64 g_frames = 0, g_fpsT = 0; static int g_evfErrs = 0;
static void pumpEvf() {
  U32 err = EdsDownloadEvfImage(g_cam, g_evfImage);
  if (err == 0) {
    void* ptr = nullptr; U64 len = 0;
    EdsGetPointer(g_evfStream, &ptr); EdsGetLength(g_evfStream, &len);
    unsigned char* b = (unsigned char*)ptr;
    if (b && len > 500 && b[0] == 0xFF && b[1] == 0xD8) {
      U64 end = 0; U64 from = len > 8192 ? len - 8192 : 2; // buang sisa byte setelah penanda akhir JPEG (FFD9)
      for (U64 i = len - 2; i >= from; i--) { if (b[i] == 0xFF && b[i + 1] == 0xD9) { end = i + 2; break; } if (i == 0) break; }
      if (end) { packet('F', b, (uint32_t)end); g_frames++; g_evfErrs = 0; return; }
    }
    sleepMs(2); return;
  }
  if (err == ERR_OBJECT_NOTREADY || err == ERR_DEVICE_BUSY) { sleepMs(4); return; } // frame belum siap: coba lagi segera
  if (err == ERR_DEVICE_INVALID || err == ERR_COMM_DISCONNECTED) { g_shutdownSeen = true; return; }
  if (++g_evfErrs % 40 == 1) say("ERROR|Live view gagal SDK=" + hex(err));
  sleepMs(30);
}

// ---------- Setelan kamera (seperti "dslr Camera Settings"): baca & ubah ISO / shutter / aperture / white balance ----------
static std::string jesc(const std::string& s) { std::string o; for (char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += c; } else if ((unsigned char)c >= 32) o += c; } return o; }
static std::string isoName(U32 c) {
  static const struct { U32 c; const char* n; } T[] = { {0x00,"Auto"},{0x28,"6"},{0x30,"12"},{0x38,"25"},{0x40,"50"},{0x48,"100"},{0x4b,"125"},{0x4d,"160"},{0x50,"200"},{0x53,"250"},{0x55,"320"},{0x58,"400"},{0x5b,"500"},{0x5d,"640"},{0x60,"800"},{0x63,"1000"},{0x65,"1250"},{0x68,"1600"},{0x6b,"2000"},{0x6d,"2500"},{0x70,"3200"},{0x73,"4000"},{0x75,"5000"},{0x78,"6400"},{0x7b,"8000"},{0x7d,"10000"},{0x80,"12800"},{0x88,"25600"},{0x90,"51200"},{0x98,"102400"} };
  for (auto& t : T) if (t.c == c) return t.n;
  return "kode " + hex(c);
}
static std::string avName(U32 c) { // f = 2^((kode-8)/16): f1 = 0x08, f2 = 0x18, f2.8 = 0x20
  if (c < 8 || c > 0x70) return "kode " + hex(c);
  double f = 1.0; int k = (int)c - 8; for (int i = 0; i < k; i++) f *= 1.0442737824274138; // 2^(1/16)
  static const double S[] = {1,1.1,1.2,1.4,1.6,1.8,2,2.2,2.5,2.8,3.2,3.5,4,4.5,5,5.6,6.3,7.1,8,9,10,11,13,14,16,18,20,22,25,29,32,36,40,45};
  double best = S[0]; for (double v : S) if (std::fabs(v - f) < std::fabs(best - f)) best = v;
  char b[24]; if (best >= 10) snprintf(b, sizeof b, "f/%.0f", best); else snprintf(b, sizeof b, "f/%.1f", best);
  return b;
}
static std::string tvName(U32 c) { // detik = 2^((0x38-kode)/8): 0x38 = 1", 0x68 = 1/60, 0x78 = 1/250
  if (c < 0x0c || c > 0xa8) return "kode " + hex(c);
  int d = (int)0x38 - (int)c; double sec = 1.0; for (int i = 0; i < (d < 0 ? -d : d); i++) sec *= 1.0905077326652577; // 2^(1/8)
  if (d < 0) sec = 1.0 / sec;
  char b[24];
  if (sec >= 0.95) {
    static const double L[] = {1,1.3,1.6,2,2.5,3.2,4,5,6,8,10,13,15,20,25,30};
    double best = L[0]; for (double v : L) if (std::fabs(v - sec) < std::fabs(best - sec)) best = v;
    if (best == (int)best) snprintf(b, sizeof b, "%d\"", (int)best); else snprintf(b, sizeof b, "%.1f\"", best);
    return b;
  }
  static const int S[] = {2,3,4,5,6,8,10,13,15,20,25,30,40,50,60,80,100,125,160,200,250,320,400,500,640,800,1000,1250,1600,2000,2500,3200,4000,5000,6400,8000};
  double den = 1.0 / sec; int best = S[0]; for (int v : S) if (fabs(v - den) < fabs(best - den)) best = v;
  snprintf(b, sizeof b, "1/%d", best); return b;
}
static std::string wbName(U32 c) {
  switch (c) { case 0: return "Auto"; case 1: return "Daylight"; case 2: return "Cloudy"; case 3: return "Tungsten"; case 4: return "Fluorescent"; case 5: return "Flash"; case 6: return "Custom"; case 8: return "Shade"; case 9: return "Kelvin"; case 10: return "Auto (white priority)"; default: return "kode " + hex(c); }
}
static U32 propIdOf(const std::string& n) { return n == "iso" ? PROP_ISO : n == "av" ? PROP_AV : n == "tv" ? PROP_TV : n == "wb" ? PROP_WB : 0; }
static std::string nameOf(const std::string& n, U32 c) { return n == "iso" ? isoName(c) : n == "av" ? avName(c) : n == "tv" ? tvName(c) : wbName(c); }
static std::string propJson(const std::string& n) {
  U32 id = propIdOf(n), cur = 0; bool okc = getProp(id, cur);
  std::string o = "\"" + n + "\":{\"cur\":" + (okc ? "\"" + std::to_string(cur) + "\"" : std::string("null")) + ",\"opts\":[";
  PropDesc d; memset(&d, 0, sizeof d);
  if (EdsGetPropertyDesc(g_cam, id, &d) == 0 && d.num > 0 && d.num <= 128) {
    for (int i = 0; i < d.num; i++) { if (i) o += ","; o += "[\"" + std::to_string((U32)d.vals[i]) + "\",\"" + jesc(nameOf(n, (U32)d.vals[i])) + "\"]"; }
  }
  return o + "]}";
}
static void camInfo() {
  if (!g_connected || !g_cam) { say("CAMINFO|{\"error\":\"Kamera belum tersambung\"}"); return; }
  bool reb = g_boosted; if (reb) boostRestore(); // laporkan setelan ASLI, bukan yang sedang diterangkan untuk live view
  U32 ae = 0; getProp(PROP_AE_MODE, ae);
  say("CAMINFO|{\"brand\":\"canon\",\"mode\":" + std::to_string(ae) + ",\"manual\":" + (ae == AE_MANUAL ? "true" : "false") + "," + propJson("iso") + "," + propJson("av") + "," + propJson("tv") + "," + propJson("wb") + "}");
  if (reb && g_evf && g_boostStops > 0) boostApply();
}
static void camSet(const std::string& n, const std::string& v) {
  U32 id = propIdOf(n);
  if (!g_connected || !g_cam) { say("CAMSET_FAILED|" + n + "|Kamera belum tersambung"); return; }
  if (!id || v.empty()) { say("CAMSET_FAILED|" + n + "|Perintah tidak lengkap"); return; }
  bool reb = g_boosted; if (reb) boostRestore();
  U32 want = (U32)strtoul(v.c_str(), nullptr, 10);
  bool ok = setVerified(id, want);
  if (reb && g_evf && g_boostStops > 0) boostApply();
  if (ok) say("CAMSET_OK|" + n); else say("CAMSET_FAILED|" + n + "|Kamera menolak nilai ini (pastikan mode kamera M dan nilainya tersedia)");
  camInfo();
}

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY); _setmode(_fileno(stdin), _O_BINARY);
#endif
  std::string why;
  { char path[MAX_PATH]; GetModuleFileNameA(nullptr, path, MAX_PATH); std::string d(path); size_t p = d.find_last_of("\\/"); g_dir = p == std::string::npos ? "." : d.substr(0, p); }
  say("READY|popsnap_canon_bridge/1");
  if (!loadSdk(why)) { say("ERROR|" + why); }
  else {
    U32 err = EdsInitializeSDK();
    if (err) say("ERROR|EdsInitializeSDK gagal " + hex(err)); else g_sdkReady = true;
  }
  std::thread(stdinThread).detach();
  g_fpsT = nowMs();
  while (g_running) {
    std::string cmd; bool have = false;
    { std::lock_guard<std::mutex> lk(g_cmdMu); if (!g_cmds.empty()) { cmd = g_cmds.front(); g_cmds.pop_front(); have = true; } }
    if (have) {
      if (cmd == "CONNECT") connectCamera();
      else if (cmd == "LIVEVIEW_START") evfStart();
      else if (cmd == "LIVEVIEW_STOP") evfStop(true);
      else if (cmd.rfind("LV_BOOST", 0) == 0) { int n = atoi(cmd.c_str() + 8); if (n < 0) n = 0; if (n > 6) n = 6; g_boostStops = n; if (n == 0) boostRestore(); else if (g_evf && !g_boosted) boostApply(); }
      else if (cmd == "CAM_INFO") camInfo();
      else if (cmd.rfind("CAM_SET ", 0) == 0) { size_t a = cmd.find(' ', 8); if (a == std::string::npos) say("CAMSET_FAILED||Perintah tidak lengkap"); else camSet(cmd.substr(8, a - 8), cmd.substr(a + 1)); }
      else if (cmd == "CAPTURE") capture();
      else if (cmd == "DISCONNECT") disconnect(true);
      else if (cmd == "QUIT") break;
      else say("ERROR|Perintah tidak dikenal: " + cmd);
      continue;
    }
    if (g_sdkReady) EdsGetEvent();
    if (g_shutdownSeen && g_connected) { disconnect(true); }
    if (g_connected && g_evf) pumpEvf(); else sleepMs(10);
    U64 t = nowMs();
    if (t - g_fpsT >= 1000) { if (g_evf) say("FPS|" + std::to_string((unsigned long long)(g_frames * 1000 / (t - g_fpsT)))); g_frames = 0; g_fpsT = t; }
  }
  boostRestore(); // jangan tinggalkan kamera dalam keadaan "diterangkan"
  disconnect(false);
  if (g_sdkReady) EdsTerminateSDK();
  return 0;
}
