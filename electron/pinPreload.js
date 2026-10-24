// Preload khusus jendela PIN (pin.html): hanya dua fungsi — kirim PIN untuk diperiksa, atau batal.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("popsnapPin", {
  submit: (pin) => ipcRenderer.invoke("pin:submit", String(pin ?? "")),
  cancel: () => ipcRenderer.send("pin:cancel"),
});
