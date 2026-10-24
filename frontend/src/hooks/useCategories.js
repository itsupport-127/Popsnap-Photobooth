import { useCallback, useEffect, useState } from "react";
import appConfig from "../config/appConfig";
import { listCategories } from "../services/categoryService";

/** Daftar kategori template dari backend (mulai dari bawaan agar render pertama tidak kosong). */
export default function useCategories() {
  const [categories, setCategories] = useState(() => appConfig.templateCategories.map((c) => ({ ...c, count: 0 })));
  const reload = useCallback(() => listCategories().then((l) => Array.isArray(l) && l.length && setCategories(l)), []);
  useEffect(() => { reload(); }, [reload]);
  return { categories, reload };
}
