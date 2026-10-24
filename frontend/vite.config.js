import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.POPSNAP_EXE ? './' : '/', // build .exe (build-exe.bat) memuat dari file:// -> alamat aset harus relatif
})
