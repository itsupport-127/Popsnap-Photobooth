import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { STATES, createInitialSession, sessionReducer } from "./state/sessionMachine";
import WelcomeScreen from "./screens/WelcomeScreen";
import TemplateScreen from "./screens/TemplateScreen";
import PaymentScreen from "./screens/PaymentScreen";
import PhotoSessionScreen from "./screens/PhotoSessionScreen";
import EditorScreen from "./screens/EditorScreen";
import ResultScreen from "./screens/ResultScreen";
import LoginScreen from "./admin/LoginScreen";
import AdminApp from "./admin/AdminApp";
import useCameraStatus from "./hooks/useCameraStatus";
import { KioskProvider } from "./hooks/useKiosk";
import ReminderScreen from "./screens/ReminderScreen";
import ConsentScreen from "./screens/ConsentScreen";
import DisclaimerScreen from "./screens/DisclaimerScreen";
import MediaCaptureScreen from "./screens/MediaCaptureScreen";
import KioskLock from "./components/KioskLock";
import Backdrop from "./components/Backdrop";
import { loadRuntimeConfig } from "./services/settingsService";
import { getCurrentUser, getToken, refreshMe } from "./services/authService";
import { listTemplatesByCategory } from "./services/templateService";

// ==========================================================
// App diberi 2 rute:
//   "/"       -> KioskApp, alur utama yang dipakai konsumen (PUBLIC, gak perlu login)
//   "/admin"  -> AdminGate, DILINDUNGI login. Nampilin Template Editor kalau
//                role "admin", atau halaman voucher kalau role "cashier".
// ==========================================================
// Di aplikasi desktop (.exe) halaman dimuat dari file:// — BrowserRouter tidak bisa
// membaca rute /admin di situ, jadi pakai HashRouter (#/admin). Di browser/dev tetap BrowserRouter.
const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <KioskProvider>
        <Routes>
          <Route path="/" element={<KioskApp />} />
          <Route path="/admin/*" element={<AdminGate />} />
        </Routes>
      </KioskProvider>
    </Router>
  );
}

function AdminGate() {
  const [user, setUser] = useState(() => (getToken() ? getCurrentUser() : null));
  // Sesi lama (sebelum ada sistem hak akses) belum punya daftar permissions -> ambil yang terbaru dulu
  const [ready, setReady] = useState(() => !getToken() || !!getCurrentUser()?.permissions);
  useEffect(() => {
    if (ready) return;
    refreshMe().then((u) => { setUser(u); setReady(true); }).catch(() => { setUser(null); setReady(true); });
  }, [ready]);
  if (!ready) return <div className="h-screen w-screen flex items-center justify-center bg-pop-dark text-white">Memuat...</div>;
  if (!user) return <LoginScreen onAuthenticated={(u) => { setUser(u); setReady(true); }} />;
  return <AdminApp user={user} onLogout={() => setUser(null)} />;
}

function KioskApp() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, createInitialSession);
  const [templatesByCategory, setTemplatesByCategory] = useState({
    strip2: [], print4r: [], custom: [], personalize: [],
  });

  const [settings, setSettings] = useState(null);
  const camera = useCameraStatus();
  const firstLoad = useRef(true);

  useEffect(() => {
    listTemplatesByCategory().then(setTemplatesByCategory);
  }, []);

  // Muat pengaturan admin (timer, jumlah foto, mode kamera, nama event, mode bayar).
  // Dimuat ulang tiap kembali ke Welcome supaya perubahan dari /admin langsung berlaku tanpa restart.
  useEffect(() => {
    if (session.state !== STATES.WELCOME) return;
    loadRuntimeConfig().then((s) => {
      setSettings(s);
      // Aplikasi desktop selalu dibuka layar penuh; kalau admin mematikan "Start App in Full Screen", keluarkan sekali saat awal
      if (firstLoad.current) {
        firstLoad.current = false;
        if (s.display?.startFullscreen === false) window.electronAPI?.kiosk?.setFullscreen?.(false);
      }
    }).catch(() => {});
  }, [session.state]);

  // Template yang tampil di booth: HANYA yang favorit (bintang di Template Editor) = "Live". Sisanya Draft, tidak tampil.
  // (atau satu template saja, tamu tidak memilih)
  const { visibleTemplates, singleTemplate } = useMemo(() => {
    const choice = settings?.display?.startScreen?.templateChoice ?? "favorites";
    const all = Object.values(templatesByCategory).flat();
    if (choice === "single") {
      const one = all.find((t) => t.id === settings.display.startScreen.singleTemplateId);
      if (one) return { visibleTemplates: templatesByCategory, singleTemplate: one };
    }
    const filtered = {};
    for (const [cat, list] of Object.entries(templatesByCategory)) filtered[cat] = list.filter((t) => t.favorite);
    return { visibleTemplates: filtered, singleTemplate: null };
  }, [templatesByCategory, settings]);

  // Refresh ulang daftar template tiap kali konsumen MASUK ke layar pilih
  // template — jadi template baru yang diupload admin langsung kepakai tanpa
  // perlu restart/refresh app secara manual.
  useEffect(() => {
    if (session.state === STATES.TEMPLATE_CATEGORY) {
      listTemplatesByCategory().then(setTemplatesByCategory);
    }
  }, [session.state]);

  return (
    <div className="kiosk-root h-screen w-screen overflow-hidden">
      <Backdrop />
      {session.state === STATES.WELCOME && (
        <WelcomeScreen dispatch={dispatch} settings={settings} camera={camera} singleTemplate={singleTemplate} />
      )}

      {(session.state === STATES.TEMPLATE_CATEGORY || session.state === STATES.TEMPLATE_SELECT) && (
        <TemplateScreen session={session} dispatch={dispatch} templatesByCategory={visibleTemplates} />
      )}

      {session.state === STATES.PAYMENT && (
        <PaymentScreen session={session} dispatch={dispatch} />
      )}

      {session.state === STATES.DISCLAIMER && <DisclaimerScreen dispatch={dispatch} />}

      {session.state === STATES.CONSENT && <ConsentScreen dispatch={dispatch} />}
      {session.state === STATES.REMINDER && <ReminderScreen session={session} dispatch={dispatch} />}

      {session.state === STATES.MEDIA_CAPTURE && <MediaCaptureScreen session={session} dispatch={dispatch} />}

      {session.state === STATES.PHOTO_SESSION && (
        <PhotoSessionScreen session={session} dispatch={dispatch} />
      )}

      {session.state === STATES.EDITOR && (
        <EditorScreen session={session} dispatch={dispatch} />
      )}

      {session.state === STATES.RESULT && (
        <ResultScreen session={session} dispatch={dispatch} />
      )}

      {/* Gembok -> PIN: ada di SEMUA layar booth. Posisi & gaya diatur di Admin > Pengaturan > Tampilan. */}
      <KioskLock screenKey={session.state} inSession={session.state !== STATES.WELCOME} />
    </div>
  );
}
