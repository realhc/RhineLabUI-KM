import * as THREE from "three";

type Scalar = { value: number };
export type ModelLookMaterialState = {
  color: { value: THREE.Color };
  amount: Scalar;
  coating: Scalar;
  clarity: Scalar;
};

const body = new Set(["Frosted_Polymer", "Ivory_Edges", "Optical_Diffuser", "Internal_Ceramic"]);
const optical = new Set([
  "Subsurface_Optics", "Optical_Edges", "Optical_Film", "Optical_Film_Edge",
  "Amber_Optical_Inlay", "Optical_Glass_Body", "Optical_Glass_Roof",
  "Optical_Glass_Edge", "Optical_Bridge_Glass",
]);
const metal = new Set(["Titanium_Fasteners", "Optical_Clips", "Index_Inlay", "Champagne_Index"]);

// Radix Teal 7 / Iris 7 provide a restrained optical edge, in linear RGB.
const pearlCool = new THREE.Color("#83d3c0");
const pearlWarm = new THREE.Color("#b7baf8");

/**
 * User-selected color and coating on existing surfaces. The hook only reads
 * positions and changes fragment shading; geometry and optical volume remain
 * untouched. A zero color amount and natural coating preserve the old look.
 */
export function applyModelLookMaterial(
  material: THREE.Material,
  name: string,
  instanced = false,
  clarity: Scalar = { value: 0 },
): ModelLookMaterialState | undefined {
  if (!(material instanceof THREE.MeshStandardMaterial) ||
      !(body.has(name) || optical.has(name) || metal.has(name))) return;

  const cover = name === "Frosted_Polymer";
  const colorWeight = metal.has(name) ? "0.64" : optical.has(name) ? "0.82" : "1.0";
  const state: ModelLookMaterialState = {
    color: { value: new THREE.Color(1, 1, 1) },
    amount: { value: 0 },
    coating: { value: 0 },
    clarity,
  };
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.rhineModelLookColor = state.color;
    shader.uniforms.rhineModelLookAmount = state.amount;
    shader.uniforms.rhineModelLookCoating = state.coating;
    shader.uniforms.rhineModelLookClarity = state.clarity;
    shader.uniforms.rhineModelLookPearlCool = { value: pearlCool };
    shader.uniforms.rhineModelLookPearlWarm = { value: pearlWarm };
    if (instanced) {
      shader.vertexShader =
        "attribute vec3 modelLookColor;\nattribute float modelLookAmount;\nvarying vec3 vRhineModelLookColor;\nvarying float vRhineModelLookAmount;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRhineModelLookColor = modelLookColor;\nvRhineModelLookAmount = modelLookAmount;",
      );
      shader.fragmentShader =
        "varying vec3 vRhineModelLookColor;\nvarying float vRhineModelLookAmount;\n" + shader.fragmentShader;
    }
    shader.fragmentShader =
      "uniform vec3 rhineModelLookColor;\nuniform float rhineModelLookAmount;\nuniform float rhineModelLookCoating;\nuniform float rhineModelLookClarity;\nuniform vec3 rhineModelLookPearlCool;\nuniform vec3 rhineModelLookPearlWarm;\n" + shader.fragmentShader;

    // Metalness is declared by this include, so coating changes belong after it.
    // The front cover keeps both calibrated roughness endpoints and metalness.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
float rhineLookCoat = floor(clamp(rhineModelLookCoating, 0.0, 3.0) + 0.5);
float rhineLookSatin = step(0.5, rhineLookCoat) * (1.0 - step(1.5, rhineLookCoat));
float rhineLookMetal = step(1.5, rhineLookCoat) * (1.0 - step(2.5, rhineLookCoat));
float rhineLookPearl = step(2.5, rhineLookCoat);
${cover ? "" : `if (rhineLookSatin > 0.5) roughnessFactor = max(roughnessFactor, 0.64);
if (rhineLookMetal > 0.5) {
  roughnessFactor = mix(roughnessFactor, 0.18, 0.84);
  metalnessFactor = max(metalnessFactor, 0.76);
}
if (rhineLookPearl > 0.5) roughnessFactor = mix(roughnessFactor, 0.3, 0.5);`}`,
    );

    // This is later than the theme tint and earlier than physical lighting.
    // A clear cover retains only a small tint at the face and more at its rim,
    // leaving the photograph underneath readable throughout decryption.
    const amount = instanced ? "vRhineModelLookAmount" : "rhineModelLookAmount";
    const color = instanced ? "vRhineModelLookColor" : "rhineModelLookColor";
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
float rhineLookGrazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
rhineLookGrazing *= rhineLookGrazing;
float rhineLookClear = clamp(rhineModelLookClarity, 0.0, 1.0);
float rhineLookSurface = ${cover ? "mix(0.86, 0.1 + 0.24 * rhineLookGrazing, rhineLookClear)" : colorWeight};
float rhineLookAmount = clamp(${amount}, 0.0, 1.0) * rhineLookSurface;
if (rhineLookAmount > 0.0) {
  float rhineLookLuma = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 1.5, 0.0, 1.0);
  vec3 rhineLookTint = clamp(${color}, 0.0, 1.0) * (0.72 + 0.28 * rhineLookLuma);
  diffuseColor.rgb = mix(diffuseColor.rgb, rhineLookTint, rhineLookAmount);
}
if (rhineLookPearl > 0.5) {
  vec3 rhineLookPearlTint = mix(rhineModelLookPearlWarm, rhineModelLookPearlCool, 0.5 + 0.5 * normal.x);
  float rhineLookPearlAmount = (0.025 + 0.16 * rhineLookGrazing) * ${cover ? "mix(1.0, 0.22, rhineLookClear)" : "1.0"};
  diffuseColor.rgb = mix(diffuseColor.rgb, rhineLookPearlTint, rhineLookPearlAmount);
}`,
    );

    // Do not enable a material define or alter the underlying optical volume.
    // Clearcoat changes only affect surfaces that already compiled that feature.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_fragment>",
      `#include <lights_physical_fragment>
if (rhineLookSatin > 0.5) {
  material.specularColorBlended *= 0.72;
}
${cover ? `if (rhineLookMetal > 0.5) {
  vec3 rhineLookSilver = mix(vec3(0.28), clamp(${color}, 0.0, 1.0) * 0.38, clamp(${amount}, 0.0, 1.0));
  material.specularColorBlended = mix(material.specularColorBlended, rhineLookSilver, (0.14 + 0.48 * rhineLookGrazing) * mix(1.0, 0.48, rhineLookClear));
}` : ""}
#ifdef USE_CLEARCOAT
  if (rhineLookSatin > 0.5) {
    material.clearcoat *= 0.7;
    material.clearcoatRoughness = max(material.clearcoatRoughness, 0.5);
  }
  if (rhineLookMetal > 0.5) material.clearcoatRoughness = min(material.clearcoatRoughness, 0.18);
  if (rhineLookPearl > 0.5) {
    material.clearcoat = max(material.clearcoat, 0.38);
    material.clearcoatRoughness = min(material.clearcoatRoughness, 0.22);
  }
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${key}-rhine-model-look-v1-${name}-${instanced}`;
  return state;
}
