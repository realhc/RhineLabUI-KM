const { contextBridge, ipcRenderer } = require("electron");
const invoke =
  (name) =>
  async (...args) => {
    const result = await ipcRenderer.invoke(`rhine:${name}`, ...args);
    if (!result.ok) {
      const error = new Error(result.error);
      error.code = result.code;
      throw error;
    }
    return result.value;
  };
contextBridge.exposeInMainWorld("rhine", {
  ...Object.fromEntries(
    [
      "list",
      "read",
      "create",
      "save",
      "reorder",
      "createCategory",
      "renameCategory",
      "removeCategory",
      "moveDocument",
      "trash",
      "restore",
      "purge",
      "openFolder",
      "openExternal",
      "exportPreferences",
      "fullscreen",
    ].map((name) => [name, invoke(name)]),
  ),
  setDirty: (value) => ipcRenderer.send("rhine:dirty", value === true),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("rhine:changed", listener);
    return () => ipcRenderer.removeListener("rhine:changed", listener);
  },
});
