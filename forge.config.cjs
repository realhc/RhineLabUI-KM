const { copyFile } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = {
  packagerConfig: {
    name: "RhineLab",
    executableName: "RhineLab",
    appBundleId: "io.github.realhc.rhinelab",
    asar: true,
    prune: true,
    afterComplete: [
      (buildPath, _electronVersion, _platform, _arch, done) => {
        Promise.all([
          copyFile(
            join(__dirname, "LICENSE"),
            join(buildPath, "RhineLab-LICENSE.txt"),
          ),
          copyFile(
            join(__dirname, "release/desktop/site/THIRD-PARTY-NOTICES.txt"),
            join(buildPath, "THIRD-PARTY-NOTICES.txt"),
          ),
          copyFile(
            join(__dirname, "release/desktop/site/DESKTOP-LICENSES.md"),
            join(buildPath, "DESKTOP-LICENSES.md"),
          ),
        ]).then(() => done(), done);
      },
    ],
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
