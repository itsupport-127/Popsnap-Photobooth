// ============================================================================
// popsnap_nikon_bridge — program perantara Nikon (MAID3, kamera seri D) untuk POPSNAP. 64-bit.
// Protokol SAMA dengan popsnap_canon_bridge:  stdout biner [1B jenis T/F/P][4B panjang little-endian][isi]
//   T = teks, F = frame live view (JPEG), P = foto hasil jepret (JPEG)
// Perintah (stdin, per baris): CONNECT | LIVEVIEW_START | LIVEVIEW_STOP | CAPTURE | DISCONNECT | QUIT | LV_BOOST <n>
//   CAM_INFO: balas teks CAMINFO|{json} (mode, ISO, shutter, aperture, white balance + daftar pilihan; kunci pilihan = indeks daftar kamera)
//   CAM_SET <iso|av|tv|wb> <indeks>: ubah satu setelan. Balasan CAMSET_OK|<prop> atau CAMSET_FAILED|<prop>|<sebab>, lalu CAMINFO baru.
//   LV_BOOST n: selama live view, ISO kamera dinaikkan n stop (0 = mati, maks 6; batas ISO 6400) supaya preview terang walau setelan foto
//   untuk flash. ISO asli dikembalikan saat live view berhenti / sebelum jepret / saat keluar (dan dipulihkan dari file cadangan bila program mati).
// Teks: READY|.., CONNECTED|nama, DISCONNECTED, LIVEVIEW_STARTED, LIVEVIEW_STOPPED, CAPTURE_OK|n, CAPTURE_FAILED|sebab,
//       ERROR|pesan, FPS|n
// Argumen 1 (opsional): folder berisi TypeXXXX.md3 + NkdPTP.dll (default: folder exe).
// Dibangun dengan wrapper/ (nikoncswrapper, CC BY 3.0). Bahasa C# 5 supaya bisa dikompilasi csc bawaan Windows.
// ============================================================================
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Nikon;

namespace PopsnapNikon
{
    static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetDllDirectory(string path);

        static Stream _out;
        static readonly object _outLock = new object();
        static NikonManager _manager;
        static NikonDevice _device;
        static readonly object _devLock = new object();
        static volatile bool _lvWanted;
        static volatile bool _quit;
        static volatile bool _capturing;
        static Thread _lvThread;
        static string _dir;
        static bool _firstLogged;

        // ---------------- "Auto Exposure" live view: ISO dinaikkan sementara ----------------
        static int _boostStops;
        static bool _boosted;
        static int _origIsoIndex = -1;
        static double _origIsoValue;
        static string BakPath() { return Path.Combine(_dir, "popsnap_lv_exposure.bak"); }

        static double NumVal(object o)
        {
            if (o == null) return 0;
            try
            {
                if (o is uint) return (double)(uint)o;
                double d;
                if (double.TryParse(o.ToString().Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d)) return d;
            }
            catch (Exception) { }
            return 0; // "Hi 1", "Auto", dsb: bukan angka ISO biasa -> diabaikan
        }

        // ---------------- kualitas & kecerahan live view bawaan kamera ----------------
        static bool _expPreviewOff;   // "Exposure Preview" live view berhasil dimatikan -> preview sudah terang, ISO tidak perlu dinaikkan

        // Isi kapabilitas bernilai angka (bisa bertipe unsigned atau enum). true = nilainya sudah sesuai.
        static bool TrySetCap(eNkMAIDCapability cap, uint value, string label)
        {
            try
            {
                if (_device == null || !_device.SupportsCapability(cap)) { Text("INFO|" + label + ": tidak didukung kamera ini"); return false; }
                try { _device.SetUnsigned(cap, value); return true; }
                catch (Exception) { /* mungkin bertipe enum */ }
                NikonEnum e = _device.GetEnum(cap);
                if (e == null) return false;
                for (int i = 0; i < e.Length; i++)
                {
                    object o = e[i];
                    if (o != null && o is uint && (uint)o == value) { e.Index = i; _device.SetEnum(cap, e); return true; }
                }
                Text("INFO|" + label + ": nilai " + value + " tidak tersedia");
                return false;
            }
            catch (Exception ex) { Text("INFO|" + label + ": " + ex.Message); return false; }
        }

        // Dipanggil sebelum & sesudah live view dinyalakan (sebagian kamera baru menerima pengaturan ini saat live view aktif).
        static void TuneLiveView()
        {
            // 1) ukuran gambar live view: XGA (1024x768). Bawaan banyak kamera QVGA (320x240) -> terlihat buram/pecah saat diperbesar
            if (TrySetCap(eNkMAIDCapability.kNkMAIDCapability_LiveViewImageSize, (uint)eNkMAIDLiveViewImageSize.kNkMAIDLiveViewImageSize_XGA, "LiveViewImageSize")) { if (!_sizeLogged) { _sizeLogged = true; Text("INFO|ukuran live view = XGA"); } }
            // 2) Exposure Preview mati: preview selalu terang walau setelan foto untuk flash (shutter cepat / ISO rendah)
            if (TrySetCap(eNkMAIDCapability.kNkMAIDCapability_LiveViewExposurePreview, (uint)eNkMAIDLiveViewExposurePreview.kNkMAIDLiveViewExposurePreview_Off, "LiveViewExposurePreview")) { if (!_expPreviewOff) Text("INFO|exposure preview live view dimatikan (preview terang)"); _expPreviewOff = true; }
        }
        static bool _sizeLogged;

        static void BoostApply()
        {
            if (_boosted || _boostStops <= 0 || _device == null) return;
            if (_expPreviewOff) return; // preview sudah terang dari kamera: menaikkan ISO hanya menambah noise (terlihat buram)
            try
            {
                eNkMAIDCapability cap = eNkMAIDCapability.kNkMAIDCapability_Sensitivity;
                if (!_device.SupportsCapability(cap)) { Text("INFO|Kamera tidak mengizinkan ISO diubah lewat SDK; Auto Exposure dilewati"); return; }
                NikonEnum e = _device.GetEnum(cap);
                if (e == null || e.Length < 2) return;
                int orig = e.Index;
                double ov = NumVal(e[orig]);
                if (ov <= 0) return; // ISO Auto / tak terbaca: biarkan
                double target = ov * Math.Pow(2, _boostStops);
                if (target > 6400) target = 6400;
                int best = orig; double bestV = ov;
                for (int i = 0; i < e.Length; i++)
                {
                    double v = NumVal(e[i]);
                    if (v > bestV && v <= target + 0.5) { best = i; bestV = v; }
                }
                if (best == orig) return;
                _origIsoIndex = orig; _origIsoValue = ov;
                try { File.WriteAllText(BakPath(), orig + " " + ov.ToString(System.Globalization.CultureInfo.InvariantCulture)); } catch (Exception) { }
                _boosted = true; // dicatat DULU supaya pasti dikembalikan
                e.Index = best;
                _device.SetEnum(cap, e);
                Text("LV_BOOSTED|ISO " + ov + " -> " + bestV);
            }
            catch (Exception ex) { Text("INFO|Auto Exposure gagal: " + ex.Message); }
        }

        // true = ISO asli sudah kembali (atau memang tidak sedang dinaikkan)
        static bool BoostRestore()
        {
            if (!_boosted) return true;
            if (_device == null) return false; // file cadangan dipakai saat kamera tersambung lagi
            eNkMAIDCapability cap = eNkMAIDCapability.kNkMAIDCapability_Sensitivity;
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    NikonEnum e = _device.GetEnum(cap);
                    int idx = _origIsoIndex;
                    // indeks bisa bergeser bila daftar ISO berubah: cocokkan lewat nilainya
                    if (idx < 0 || idx >= e.Length || NumVal(e[idx]) != _origIsoValue)
                    {
                        idx = -1;
                        for (int i = 0; i < e.Length; i++) if (NumVal(e[i]) == _origIsoValue) { idx = i; break; }
                    }
                    if (idx < 0) break;
                    if (e.Index != idx) { e.Index = idx; _device.SetEnum(cap, e); }
                    NikonEnum chk = _device.GetEnum(cap);
                    if (chk.Index == idx) { _boosted = false; try { File.Delete(BakPath()); } catch (Exception) { } Text("LV_RESTORED"); return true; }
                }
                catch (Exception) { }
                Thread.Sleep(150);
            }
            Text("ERROR|Gagal mengembalikan ISO kamera. Cek setelan ISO di kamera.");
            return false;
        }

        // Sisa sesi sebelumnya (program mati saat ISO dinaikkan)? pulihkan begitu kamera tersambung.
        static void BoostRecover()
        {
            try
            {
                if (!File.Exists(BakPath())) return;
                string[] p = File.ReadAllText(BakPath()).Trim().Split(' ');
                double v;
                if (p.Length == 2 && double.TryParse(p[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) && v > 0)
                { _origIsoIndex = -1; _origIsoValue = v; _boosted = true; BoostRestore(); }
                else File.Delete(BakPath());
            }
            catch (Exception) { }
        }

        // ---------------- Setelan kamera (seperti "dslr Camera Settings"): ISO / shutter / aperture / white balance ----------------
        static string JEsc(string s)
        {
            System.Text.StringBuilder b = new System.Text.StringBuilder();
            foreach (char c in s) { if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); } else if (c >= ' ') b.Append(c); }
            return b.ToString();
        }
        static eNkMAIDCapability CapOf(string n)
        {
            switch (n)
            {
                case "iso": return eNkMAIDCapability.kNkMAIDCapability_Sensitivity;
                case "av": return eNkMAIDCapability.kNkMAIDCapability_Aperture;
                case "tv": return eNkMAIDCapability.kNkMAIDCapability_ShutterSpeed;
                case "wb": return eNkMAIDCapability.kNkMAIDCapability_WBMode;
            }
            return eNkMAIDCapability.kNkMAIDCapability_Sensitivity;
        }
        static string OptLabel(string n, object o)
        {
            if (o == null) return "?";
            if (n == "wb" && o is uint)
            {
                switch ((uint)o)
                {
                    case 0: return "Auto"; case 1: return "Daylight"; case 2: return "Fluorescent"; case 3: return "Incandescent";
                    case 4: return "Flash"; case 5: return "Cloudy"; case 6: return "Shade"; case 7: return "Preset";
                }
                return "Mode " + o;
            }
            return o.ToString().Trim();
        }
        static string PropJson(string n)
        {
            string cur = "null";
            System.Text.StringBuilder opts = new System.Text.StringBuilder();
            try
            {
                eNkMAIDCapability cap = CapOf(n);
                if (_device != null && _device.SupportsCapability(cap))
                {
                    NikonEnum e = _device.GetEnum(cap);
                    if (e != null)
                    {
                        cur = "\"" + e.Index + "\"";
                        for (int i = 0; i < e.Length; i++)
                        {
                            if (i > 0) opts.Append(',');
                            opts.Append("[\"" + i + "\",\"" + JEsc(OptLabel(n, e[i])) + "\"]");
                        }
                    }
                }
            }
            catch (Exception) { }
            return "\"" + n + "\":{\"cur\":" + cur + ",\"opts\":[" + opts + "]}";
        }
        static void CamInfo()
        {
            if (_device == null) { Text("CAMINFO|{\"error\":\"Kamera belum tersambung\"}"); return; }
            bool reb = _boosted; if (reb) BoostRestore(); // laporkan ISO ASLI, bukan yang sedang dinaikkan untuk live view
            int mode = -1;
            try
            {
                if (_device.SupportsCapability(eNkMAIDCapability.kNkMAIDCapability_ExposureMode))
                {
                    NikonEnum m = _device.GetEnum(eNkMAIDCapability.kNkMAIDCapability_ExposureMode);
                    if (m != null && m[m.Index] is uint) mode = (int)(uint)m[m.Index];
                }
            }
            catch (Exception) { }
            Text("CAMINFO|{\"brand\":\"nikon\",\"mode\":" + mode + ",\"manual\":" + (mode == 3 ? "true" : "false") + "," + PropJson("iso") + "," + PropJson("av") + "," + PropJson("tv") + "," + PropJson("wb") + "}");
            if (reb && _lvWanted && _boostStops > 0) BoostApply();
        }
        static void CamSet(string n, string v)
        {
            int idx;
            if (_device == null) { Text("CAMSET_FAILED|" + n + "|Kamera belum tersambung"); return; }
            if (!int.TryParse(v, out idx) || (n != "iso" && n != "av" && n != "tv" && n != "wb")) { Text("CAMSET_FAILED|" + n + "|Perintah tidak lengkap"); return; }
            bool reb = _boosted; if (reb) BoostRestore();
            bool ok = false; string why = "Kamera menolak nilai ini (pastikan mode kamera M dan nilainya tersedia)";
            try
            {
                eNkMAIDCapability cap = CapOf(n);
                if (!_device.SupportsCapability(cap)) why = "Kamera ini tidak mengizinkan pengaturan ini lewat USB";
                else
                {
                    NikonEnum e = _device.GetEnum(cap);
                    if (e != null && idx >= 0 && idx < e.Length)
                    {
                        e.Index = idx; _device.SetEnum(cap, e);
                        NikonEnum chk = _device.GetEnum(cap);
                        ok = chk != null && chk.Index == idx;
                    }
                }
            }
            catch (Exception ex) { why = ex.Message; }
            if (reb && _lvWanted && _boostStops > 0) BoostApply();
            if (ok) Text("CAMSET_OK|" + n); else Text("CAMSET_FAILED|" + n + "|" + why);
            CamInfo();
        }

        static void Send(char kind, byte[] data)
        {
            lock (_outLock)
            {
                try
                {
                    byte[] h = new byte[5];
                    h[0] = (byte)kind;
                    h[1] = (byte)(data.Length & 0xff); h[2] = (byte)((data.Length >> 8) & 0xff);
                    h[3] = (byte)((data.Length >> 16) & 0xff); h[4] = (byte)((data.Length >> 24) & 0xff);
                    _out.Write(h, 0, 5); _out.Write(data, 0, data.Length); _out.Flush();
                }
                catch (IOException) { _quit = true; }
            }
        }
        static void Text(string s) { Send('T', System.Text.Encoding.UTF8.GetBytes(s)); }

        static string FindMd3()
        {
            string[] f = Directory.GetFiles(_dir, "Type*.md3");
            return f.Length > 0 ? f[0] : null;
        }

        static void Connect()
        {
            lock (_devLock)
            {
                if (_device != null) { Text("CONNECTED|" + SafeName(_device)); return; }
                try
                {
                    if (_manager == null)
                    {
                        string md3 = FindMd3();
                        if (md3 == null) { Text("ERROR|File TypeXXXX.md3 tidak ada di " + _dir); return; }
                        Text("MD3|" + Path.GetFileName(md3));
                        _manager = new NikonManager(md3);
                        _manager.DeviceAdded += OnDeviceAdded;
                        _manager.DeviceRemoved += OnDeviceRemoved;
                    }
                    else if (_manager.DeviceCount > 0)
                    {
                        _device = _manager.GetDeviceByIndex(0);
                        HookDevice();
                    }
                }
                catch (NikonException ex) { Text("ERROR|" + ex.Message); _manager = null; }
                catch (Exception ex) { Text("ERROR|" + ex.GetType().Name + ": " + ex.Message); _manager = null; }
            }
        }

        static string SafeName(NikonDevice d) { try { return d.Name; } catch (Exception) { return "Nikon"; } }

        static void OnDeviceAdded(NikonManager sender, NikonDevice device)
        {
            lock (_devLock)
            {
                if (_device != null) return;
                _device = device;
                HookDevice();
            }
        }

        static void OnDeviceRemoved(NikonManager sender, NikonDevice device)
        {
            lock (_devLock) { if (_device == device) { _device = null; _lvWanted = false; } }
            Text("DISCONNECTED");
        }

        static void HookDevice()
        {
            try
            {
                _device.ImageReady += OnImageReady;
                _device.CaptureComplete += OnCaptureComplete;
                // simpan foto ke memori kamera lalu kirim ke PC (tanpa kartu) bila kamera mendukung
                try { if (_device.SupportsCapability(eNkMAIDCapability.kNkMAIDCapability_SaveMedia)) _device.SetUnsigned(eNkMAIDCapability.kNkMAIDCapability_SaveMedia, (uint)eNkMAIDSaveMedia.kNkMAIDSaveMedia_SDRAM); }
                catch (Exception ex) { Text("INFO|SaveMedia: " + ex.Message); }
                BoostRecover();
                Text("CONNECTED|" + SafeName(_device));
            }
            catch (Exception ex) { Text("ERROR|" + ex.Message); }
        }

        // ---------------- live view ----------------
        static void LiveLoop()
        {
            int n = 0; DateTime t0 = DateTime.UtcNow;
            int fails = 0;
            while (!_quit && _lvWanted)
            {
                NikonDevice d = _device;
                if (d == null || _capturing) { Thread.Sleep(30); continue; }
                try
                {
                    NikonLiveViewImage img = d.GetLiveViewImage();
                    byte[] j = ExtractJpeg(img);
                    if (j != null && j.Length > 500)
                    {
                        if (n == 0 && !_firstLogged) { _firstLogged = true; Text("INFO|frame pertama " + j.Length + " byte, " + JpegSize(j) + " (header " + img.HeaderBuffer.Length + ")"); }
                        Send('F', j); n++; fails = 0;
                    }
                    else
                    {
                        fails++;
                        if (fails == 20) Text("INFO|data live view bukan JPEG (" + (img.JpegBuffer == null ? 0 : img.JpegBuffer.Length) + " byte)");
                        Thread.Sleep(20);
                    }
                }
                catch (NikonException ex)
                {
                    // kamera belum siap / sedang sibuk -> coba lagi sebentar lagi
                    fails++;
                    if (fails == 30 || fails % 150 == 0)
                    {
                        string pr = ProhibitInfo();
                        Text("ERROR|Live view tidak menghasilkan gambar (" + ex.Message + ")." + (pr != "" ? " Kamera menolak live view: " + pr : " Pastikan kamera mode foto (bukan video), lensa terpasang."));
                    }
                    Thread.Sleep(30);
                }
                catch (Exception ex) { Text("ERROR|" + ex.Message); Thread.Sleep(200); }
                double s = (DateTime.UtcNow - t0).TotalSeconds;
                if (s >= 1.0) { Text("FPS|" + Math.Round(n / s)); n = 0; t0 = DateTime.UtcNow; }
            }
        }

        // Ambil JPEG dari data live view: cari penanda awal (FFD8) di bagian depan (ukuran header tiap model bisa beda dari dugaan
        // pembungkus), buang byte kosong setelah penanda akhir (FFD9). null = bukan JPEG.
        // Baca lebar x tinggi dari penanda SOF JPEG (untuk catatan diagnosa).
        static string JpegSize(byte[] j)
        {
            try
            {
                int i = 2;
                while (i + 9 < j.Length)
                {
                    if (j[i] != 0xFF) { i++; continue; }
                    byte m = j[i + 1];
                    if (m == 0xD8 || m == 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
                    int len = (j[i + 2] << 8) | j[i + 3];
                    if ((m >= 0xC0 && m <= 0xCF) && m != 0xC4 && m != 0xC8 && m != 0xCC) return ((j[i + 7] << 8) | j[i + 8]) + "x" + ((j[i + 5] << 8) | j[i + 6]);
                    i += 2 + len;
                }
            }
            catch (Exception) { }
            return "ukuran ?";
        }

        static byte[] ExtractJpeg(NikonLiveViewImage img)
        {
            byte[] h = img.HeaderBuffer, j = img.JpegBuffer;
            byte[] all = new byte[(h == null ? 0 : h.Length) + (j == null ? 0 : j.Length)];
            if (h != null) Buffer.BlockCopy(h, 0, all, 0, h.Length);
            if (j != null) Buffer.BlockCopy(j, 0, all, h == null ? 0 : h.Length, j.Length);
            int start = -1, lim = Math.Min(all.Length - 3, 2048);
            for (int i = 0; i < lim; i++) if (all[i] == 0xFF && all[i + 1] == 0xD8 && all[i + 2] == 0xFF) { start = i; break; }
            if (start < 0) return null;
            int end = -1, from = Math.Max(start + 2, all.Length - 16384);
            for (int i = all.Length - 2; i >= from; i--) if (all[i] == 0xFF && all[i + 1] == 0xD9) { end = i + 2; break; }
            if (end < 0) end = all.Length; // tanpa penanda akhir: kirim apa adanya, browser biasanya tetap bisa menampilkan
            byte[] o = new byte[end - start];
            Buffer.BlockCopy(all, start, o, 0, o.Length);
            return o;
        }

        // Alasan live view ditolak kamera (bit LiveViewProhibit pada dokumentasi SDK) — supaya mudah dilacak lewat log
        static string ProhibitInfo()
        {
            try
            {
                if (_device == null || !_device.SupportsCapability(eNkMAIDCapability.kNkMAIDCapability_LiveViewProhibit)) return "";
                uint v = _device.GetUnsigned(eNkMAIDCapability.kNkMAIDCapability_LiveViewProhibit);
                if (v == 0) return "";
                string s = "";
                if ((v & 1) != 0) s += " [tujuan simpan=CF]"; if ((v & 4) != 0) s += " [urutan]"; if ((v & 16) != 0) s += " [tombol rana ditekan]";
                if ((v & 32) != 0) s += " [diafragma di ring lensa]"; if ((v & 64) != 0) s += " [bulb]"; if ((v & 128) != 0) s += " [mirror-up]";
                if ((v & 256) != 0) s += " [baterai lemah]"; if ((v & 512) != 0) s += " [TTL]"; if ((v & 1024) != 0) s += " [ring diafragma aktif]";
                if ((v & 2048) != 0) s += " [lensa non-CPU: pakai mode M]"; if ((v & 4096) != 0) s += " [ada foto di SDRAM]"; if ((v & 8192) != 0) s += " [mode mirror-up]";
                if ((v & 16384) != 0) s += " [kartu tidak ada]"; if ((v & 32768) != 0) s += " [sedang jepret]"; if ((v & 131072) != 0) s += " [suhu naik]";
                if ((v & 262144) != 0) s += " [kartu terkunci]"; if ((v & 524288) != 0) s += " [kartu error]"; if ((v & 1048576) != 0) s += " [kartu belum diformat]";
                if ((v & 0x80000000) != 0) s += " [mode exposure SCENE]"; if ((v & 65536) != 0) s += " [mode EFFECTS]";
                return "0x" + v.ToString("X") + s;
            }
            catch (Exception) { return ""; }
        }

        static void StartLive()
        {
            if (_device == null) { Text("ERROR|Kamera belum tersambung"); return; }
            try
            {
                _firstLogged = false;
                TuneLiveView();
                BoostApply(); // ISO naik SEBELUM live view dinyalakan (lebih aman daripada mengubah saat berjalan)
                _device.LiveViewEnabled = true;
                TuneLiveView(); // ulangi: sebagian kamera baru menerima ukuran / exposure preview setelah live view aktif
                _lvWanted = true;
                string pr = ProhibitInfo();
                if (pr != "") Text("INFO|LiveViewProhibit=" + pr);
                Text("LIVEVIEW_STARTED");
                if (_lvThread == null || !_lvThread.IsAlive) { _lvThread = new Thread(LiveLoop); _lvThread.IsBackground = true; _lvThread.Start(); }
            }
            catch (NikonException ex) { string pr = ProhibitInfo(); Text("ERROR|Live view: " + ex.Message + (pr != "" ? " — " + pr : "")); }
        }

        static void StopLive()
        {
            _lvWanted = false;
            try { if (_lvThread != null) _lvThread.Join(1500); } catch (Exception) { }
            try { if (_device != null) _device.LiveViewEnabled = false; } catch (Exception) { }
            BoostRestore();
            Text("LIVEVIEW_STOPPED");
        }

        // ---------------- jepret ----------------
        static byte[] _photo;
        static readonly AutoResetEvent _photoEvt = new AutoResetEvent(false);
        static readonly AutoResetEvent _doneEvt = new AutoResetEvent(false);
        static bool _gotRawOnly;

        static void OnImageReady(NikonDevice sender, NikonImage image)
        {
            if (image.Type == NikonImageType.Jpeg) { _photo = image.Buffer; _photoEvt.Set(); }
            else _gotRawOnly = true;
        }
        static void OnCaptureComplete(NikonDevice sender, int data) { _doneEvt.Set(); }

        static void Capture()
        {
            if (_device == null) { Text("CAPTURE_FAILED|Kamera belum tersambung"); return; }
            bool resume = _lvWanted;
            try
            {
                _capturing = true;
                _photo = null; _gotRawOnly = false; _photoEvt.Reset(); _doneEvt.Reset();
                // beri live view sedikit waktu berhenti memakai kamera
                Thread.Sleep(120);
                if (_boosted && !BoostRestore())
                {
                    Text("CAPTURE_FAILED|ISO_BELUM_KEMBALI ISO kamera belum kembali ke setelan asli, jepret dibatalkan supaya foto tidak terlalu terang");
                    return;
                }
                _device.Capture();
                if (!_photoEvt.WaitOne(30000))
                {
                    Text("CAPTURE_FAILED|" + (_gotRawOnly ? "Kamera hanya mengirim RAW. Ubah kualitas gambar ke JPEG." : "Foto tidak datang dari kamera (timeout). Cek fokus/mode kamera."));
                    return;
                }
                byte[] p = _photo; _photo = null;
                Send('P', p);
                Text("CAPTURE_OK|" + p.Length);
            }
            catch (NikonException ex) { Text("CAPTURE_FAILED|" + ex.Message); }
            catch (Exception ex) { Text("CAPTURE_FAILED|" + ex.Message); }
            finally
            {
                _capturing = false;
                if (resume) { try { BoostApply(); _device.LiveViewEnabled = true; } catch (Exception) { } }
            }
        }

        static void Disconnect()
        {
            _lvWanted = false;
            try { if (_lvThread != null) _lvThread.Join(1500); } catch (Exception) { }
            lock (_devLock)
            {
                try { if (_device != null) _device.LiveViewEnabled = false; } catch (Exception) { }
                BoostRestore();
                _device = null;
                try { if (_manager != null) _manager.Shutdown(); } catch (Exception) { }
                _manager = null;
            }
            Text("DISCONNECTED");
        }

        static void Main(string[] args)
        {
            _out = Console.OpenStandardOutput();
            _dir = (args.Length > 0 && Directory.Exists(args[0])) ? args[0] : AppDomain.CurrentDomain.BaseDirectory;
            _dir = _dir.TrimEnd('\\');
            try { SetDllDirectory(_dir); Directory.SetCurrentDirectory(_dir); } catch (Exception) { }
            Environment.SetEnvironmentVariable("PATH", _dir + ";" + Environment.GetEnvironmentVariable("PATH"));
            Text("READY|NIKON_MAID3_X64");

            string line;
            while (!_quit && (line = Console.In.ReadLine()) != null)
            {
                line = line.Trim();
                try
                {
                    if (line == "CONNECT")
                    {
                        Connect();
                        // kamera datang lewat event DeviceAdded; beri waktu singkat
                        for (int i = 0; i < 40 && _device == null; i++) Thread.Sleep(100);
                        if (_device == null) Text("ERROR|Kamera Nikon tidak ditemukan. Nyalakan kamera, colok USB, dan tutup NX Tether/digiCamControl.");
                    }
                    else if (line.StartsWith("LV_BOOST"))
                    {
                        int n; if (!int.TryParse(line.Substring(8).Trim(), out n)) n = 0;
                        _boostStops = Math.Max(0, Math.Min(6, n));
                        if (_boostStops == 0) BoostRestore();
                    }
                    else if (line == "CAM_INFO") CamInfo();
                    else if (line.StartsWith("CAM_SET "))
                    {
                        string[] cp = line.Substring(8).Trim().Split(new char[] { ' ' }, 2);
                        if (cp.Length == 2) CamSet(cp[0], cp[1].Trim()); else Text("CAMSET_FAILED||Perintah tidak lengkap");
                    }
                    else if (line == "LIVEVIEW_START") StartLive();
                    else if (line == "LIVEVIEW_STOP") StopLive();
                    else if (line == "CAPTURE") Capture();
                    else if (line == "DISCONNECT") Disconnect();
                    else if (line == "QUIT") { _quit = true; }
                }
                catch (Exception ex) { Text("ERROR|" + ex.Message); }
            }
            Disconnect();
        }
    }
}
