module.exports = {
  packagerConfig: {
    name: "RhineLab",
    executableName: "RhineLab",
    appBundleId: "cc.lubeiluchen.rhinelab.knowledge",
    asar: true,
    prune: true,
    electronZipDir: process.env.RHINE_ELECTRON_ZIP_DIR,
    icon: "desktop/icon.ico",
    ignore: (path) => {
      const file = path.replaceAll("\\", "/");
      return (
        file !== "" &&
        !/^\/(package\.json$|desktop$|desktop\/(?:main\.mjs|preload\.cjs|repository\.mjs|directory\.mjs)$|content$|content\/archives\.json$|release$|release\/desktop$|release\/desktop\/site(?:\/|$)|LICENSE$)/.test(
          file,
        )
      );
    },
    win32metadata: {
      CompanyName: "Rhine Lab",
      FileDescription: "Rhine Lab local Markdown knowledge base",
      ProductName: "Rhine Lab",
    },
  },
  makers: [{ name: "@electron-forge/maker-zip", platforms: ["win32"] }],
  outDir: "release/packages",
};
