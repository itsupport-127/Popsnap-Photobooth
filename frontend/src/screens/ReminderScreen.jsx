import React, { useEffect, useRef, useState } from "react";
import appConfig from "../config/appConfig";
import ReminderView, { builtinItems, fmtReminderTimer } from "../components/ReminderView";

/**
 * Layar pengingat — tampil SETELAH pembayaran dan SEBELUM sesi foto.
 * Lama tampil, teks, latar, logo, dan warna diatur di Admin > Pengaturan > Tampilan.
 */
export default function ReminderScreen({ session, dispatch }) {
  const s = appConfig.settings ?? {};
  const reminder = s.display?.reminder ?? { seconds: 8, items: [] };
  const { totalShots, maxRetakes } = appConfig.photoSession;
  const items = session.mode === "photo" ? reminder.items : builtinItems(session.mode, s);
  const vars = { shots: totalShots, retakes: maxRetakes, frames: s.gif?.frames, seconds: s.boomerang?.seconds };
  const [left, setLeft] = useState(reminder.seconds);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    dispatch({ type: "REMINDER_DONE" });
  };

  useEffect(() => {
    if (left <= 0) return finish();
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  return (
    <div className="kiosk-screen relative h-full w-full" onClick={reminder.skippable ? finish : undefined}>
      <ReminderView
        reminder={reminder}
        items={items.length ? items : reminder.items}
        vars={vars}
        timerText={fmtReminderTimer(Math.max(0, left))}
        hint={reminder.skippable ? "Ketuk layar untuk langsung mulai" : null}
      />
    </div>
  );
}
