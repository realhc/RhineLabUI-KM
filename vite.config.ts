import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Keep Blender's stable source/export paths, while production URLs identify
// exact bytes and can be cached without revalidation across deployments.
const models = ["archive-cassette", "archive-assembly"].map(name => {
  const source = readFileSync(`public/assets/${name}.glb`);
  const hash = createHash("sha256").update(source).digest("hex").slice(0,16);
  return { key:`assets/${name}.glb`, fileName:`assets/${name}.${hash}.glb`, source };
});
const hasNovecento = ["Normal", "DemiBold", "Bold"].every(weight =>
  existsSync(`public/fonts/novecento/webFonts/NovecentoSansWide${weight}/font.woff2`),
);
export default defineConfig(({ mode }) => ({
  base: mode === "wallpaper" ? "./" : "/",
  build: mode === "desktop" ? { outDir: "release/desktop/site", rollupOptions: { input: "desktop.html" } } : undefined,
  define: {
    __RHINE_MODELS__: JSON.stringify(Object.fromEntries(models.map(model => [model.key,model.fileName]))),
    __RHINE_NOVECENTO__: JSON.stringify(mode !== "desktop" && hasNovecento),
  },
  plugins: [...(mode === "desktop" ? [{
    name: "desktop-library-data", enforce: "pre" as const,
    transform(code:string,id:string) {
      if(!/[/\\]src[/\\]scene\.ts$/.test(id))return;
      return {code:'import { archiveColumns as desktopColumnNames, columnFiles as desktopColumnFiles } from "./desktop-data";\n'+code.replace('Math.round((this.selectedCell.lane - 2) / 5) * 5','Math.round((this.selectedCell.lane - 2) / desktopColumnNames.length) * desktopColumnNames.length').replace('Math.floor((this.selectedCell.row - 12) / 8) * 8','Math.floor((this.selectedCell.row - 12) / desktopColumnFiles(((this.selectedCell.lane % desktopColumnNames.length)+desktopColumnNames.length)%desktopColumnNames.length).length) * desktopColumnFiles(((this.selectedCell.lane % desktopColumnNames.length)+desktopColumnNames.length)%desktopColumnNames.length).length'),map:null};
    },
    resolveId(source: string, importer: string | undefined) {
      if (importer && /\/src\//.test(importer.replaceAll("\\", "/")) && /^\.\/data(?:\.ts)?$/.test(source))
        return new URL("./src/desktop-data.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
    },
  }] : []), {
    name: "versioned-model-assets", apply: "build",
    buildStart() { for (const model of models) this.emitFile({type:"asset",fileName:model.fileName,source:model.source}); },
  }, ...(mode === "wallpaper" ? [{
    name: "wallpaper-host",
    transformIndexHtml(html: string) {
      return { html: html.replace(/\s*<link rel="manifest"[^>]*>/, ""), tags: [{
        tag: "script", children: readFileSync("wallpaper/host.js", "utf8"), injectTo: "head-prepend" as const,
      }] };
    },
  }] : [])],
}));
