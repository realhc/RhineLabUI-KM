import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Export exact Blender model bytes under content-addressed package names.
const models = ["archive-cassette", "archive-assembly"].map((name) => {
  const source = readFileSync(`public/assets/${name}.glb`);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  return {
    key: `assets/${name}.glb`,
    fileName: `assets/${name}.${hash}.glb`,
    source,
  };
});
export default defineConfig({
  base: "/",
  build: {
    outDir: "release/desktop/site",
    rollupOptions: { input: "desktop.html" },
  },
  define: {
    __RHINE_MODELS__: JSON.stringify(
      Object.fromEntries(models.map((model) => [model.key, model.fileName])),
    ),
  },
  plugins: [
    {
      name: "versioned-model-assets",
      apply: "build",
      buildStart() {
        for (const model of models)
          this.emitFile({
            type: "asset",
            fileName: model.fileName,
            source: model.source,
          });
      },
    },
  ],
});
