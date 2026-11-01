import * as THREE from "three";

type Scalar = { value: number };

const metal = new Set([
  "Titanium_Fasteners", "Optical_Clips", "Index_Inlay", "Champagne_Index",
]);
const optical = new Set([
  "Subsurface_Optics", "Optical_Edges", "Optical_Film", "Optical_Film_Edge",
  "Amber_Optical_Inlay", "Optical_Glass_Body", "Optical_Glass_Roof",
  "Optical_Glass_Edge", "Optical_Bridge_Glass",
]);
const ceramic = new Set(["Internal_Ceramic", "Optical_Diffuser", "Ivory_Edges"]);
const signal = new Set([
  "Optical_Edges", "Optical_Film_Edge", "Amber_Optical_Inlay",
  "Case_Engraving", "Case_Engraving_Highlight", "Moulded_Lettering",
]);

// Radix Amber 7/9 and Teal 7. Convert display colors to the shader's linear space.
const warmFilm = new THREE.Color("#e9c162");
const coolFilm = new THREE.Color("#83d3c0");
const readInk = new THREE.Color("#ffc53d");

/**
 * Surface-only detail on the original cassette. Coordinates are read, never
 * displaced; the outer glass, printed labels and image plane remain untouched.
 * The optional uniforms reuse the existing extraction and decryption states.
 */
export function finishMaterial(
  material: THREE.Material,
  name: string,
  quality: Scalar = { value: 1 },
  clarity: Scalar = { value: 1 },
) {
  const brushed = metal.has(name);
  const coated = optical.has(name);
  const matte = ceramic.has(name);
  const reading = signal.has(name);
  if (!brushed && !coated && !matte && !reading) return false;

  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.archiveFinishQuality = quality;
    shader.uniforms.archiveFinishClarity = clarity;
    if (coated) {
      shader.uniforms.archiveFilmWarm = { value: warmFilm };
      shader.uniforms.archiveFilmCool = { value: coolFilm };
    }
    if (reading) shader.uniforms.archiveReadInk = { value: readInk };
    shader.vertexShader = "varying vec3 vArchiveFinishPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvArchiveFinishPosition = position;",
    );
    shader.fragmentShader =
      "varying vec3 vArchiveFinishPosition;\nuniform float archiveFinishQuality;\nuniform float archiveFinishClarity;\n" +
      (coated ? "uniform vec3 archiveFilmWarm;\nuniform vec3 archiveFilmCool;\n" : "") +
      (reading ? "uniform vec3 archiveReadInk;\n" : "") + shader.fragmentShader;

    // Fade details before their period becomes subpixel. No animated noise,
    // texture allocation or added normal/displacement changes the silhouette.
    if (brushed || coated || matte) {
      const grain = brushed
        ? "sin(vArchiveFinishPosition.y * 310.0)"
        : "sin(vArchiveFinishPosition.x * 188.0) * sin(vArchiveFinishPosition.y * 211.0)";
      const amplitude = brushed ? "0.024" : coated ? "0.014" : "0.018";
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float archiveFinishFootprint = max(length(dFdx(vArchiveFinishPosition.xy)), length(dFdy(vArchiveFinishPosition.xy)));
float archiveFinishDetail = clamp(archiveFinishQuality, 0.0, 1.0) * (1.0 - smoothstep(0.003, 0.012, archiveFinishFootprint));
if (archiveFinishDetail > 0.001) {
  float archiveFinishGrain = ${grain};
  roughnessFactor = clamp(roughnessFactor + ${amplitude} * archiveFinishGrain * archiveFinishDetail, 0.04, 1.0);
}`,
      );
    }
    // A small grazing tint suggests an optical coating. It changes neither
    // the glass's transmission/IOR nor any optical or geometric thickness.
    if (coated) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
float archiveFilmGrazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
archiveFilmGrazing *= archiveFilmGrazing;
vec3 archiveFilmTint = mix(archiveFilmWarm, archiveFilmCool, 0.5 + 0.5 * normal.x);
diffuseColor.rgb = mix(diffuseColor.rgb, archiveFilmTint, 0.075 * archiveFilmGrazing * clamp(archiveFinishQuality, 0.0, 1.0));`,
      );
    }
    // The band follows the existing top-to-bottom reveal, not a new clock.
    // Its envelope is exactly zero at both clarity endpoints, including the
    // instant jumps made by reduced motion and settled/idle scenes.
    if (reading) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float archiveReadProgress = clamp(archiveFinishClarity, 0.0, 1.0);
float archiveReadEnvelope = 16.0 * archiveReadProgress * archiveReadProgress * (1.0 - archiveReadProgress) * (1.0 - archiveReadProgress);
float archiveReadHeight = clamp(vArchiveFinishPosition.y / 3.7, 0.0, 1.0);
float archiveReadBand = 1.0 - smoothstep(0.018, 0.085, abs(archiveReadHeight - (1.12 - 1.24 * archiveReadProgress)));
totalEmissiveRadiance += archiveReadInk * (0.095 * archiveReadEnvelope * archiveReadBand * clamp(archiveFinishQuality, 0.0, 1.0));`,
      );
    }
  };
  material.customProgramCacheKey = () => `${cache}-archive-finish-v1-${name}`;
  return true;
}
