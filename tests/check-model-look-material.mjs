import assert from "node:assert/strict";
import * as THREE from "three";
import { applyModelLookMaterial } from "../src/model-look-material.ts";
import { themeMaterial } from "../src/theme-material.ts";
import { finishMaterial } from "../src/material-finish.ts";

const fragment = THREE.ShaderLib.physical.fragmentShader;
const vertex = THREE.ShaderLib.physical.vertexShader;
const makeShader = () => ({ uniforms: {}, vertexShader: vertex, fragmentShader: fragment });
const physicalState = material => ({
  color: material.color.toArray(), roughness: material.roughness,
  metalness: material.metalness, opacity: material.opacity,
  transparent: material.transparent, transmission: material.transmission,
  thickness: material.thickness, ior: material.ior,
  attenuationDistance: material.attenuationDistance,
  clearcoat: material.clearcoat, clearcoatRoughness: material.clearcoatRoughness,
  defines: material.defines && { ...material.defines },
});

// Actual installed Standard and Physical shaders use the same hook anchors.
for (const create of [() => new THREE.MeshStandardMaterial(), () => new THREE.MeshPhysicalMaterial()]) {
  const material = create(), original = physicalState(material), version = material.version;
  let compiles = 0;
  material.onBeforeCompile = shader => { compiles++; shader.uniforms.previousHook = { value: 17 }; };
  const theme = themeMaterial(material, "Optical_Edges");
  const quality = { value: 1 }, clarity = { value: 0 };
  finishMaterial(material, "Optical_Edges", quality, clarity);
  const state = applyModelLookMaterial(material, "Optical_Edges", false, clarity);
  assert(state);
  assert.equal(state.clarity, clarity);
  assert.equal(state.amount.value, 0, "Natural default has no color override");
  assert.equal(state.coating.value, 0);
  const programKey = material.customProgramCacheKey();
  const shader = makeShader();
  material.onBeforeCompile(shader, null);
  assert.equal(compiles, 1, "Earlier optics/theme/finish hook is composed once");
  assert.equal(shader.uniforms.previousHook.value, 17);
  assert.equal(shader.uniforms.rhineTheme, theme);
  assert.equal(shader.uniforms.archiveFinishClarity, clarity);
  assert.equal(shader.uniforms.rhineModelLookClarity, clarity);
  assert.equal(shader.uniforms.rhineModelLookColor, state.color);
  assert.equal(shader.uniforms.rhineModelLookAmount, state.amount);
  assert.equal(shader.uniforms.rhineModelLookCoating, state.coating);
  const tint = shader.fragmentShader.indexOf("diffuseColor.rgb = mix(diffuseColor.rgb, rhineLookTint");
  const themed = shader.fragmentShader.indexOf("diffuseColor.rgb = mix(diffuseColor.rgb, rhineDarkSurface");
  assert(tint > themed && themed >= 0, "User color is applied after the theme");
  assert(shader.fragmentShader.indexOf("metalnessFactor = max") > shader.fragmentShader.indexOf("#include <metalnessmap_fragment>"));
  assert(shader.fragmentShader.indexOf("rhineLookGrazing =") > shader.fragmentShader.indexOf("#include <normal_fragment_maps>"));
  assert(shader.fragmentShader.indexOf("material.specularColorBlended *=") > shader.fragmentShader.indexOf("#include <lights_physical_fragment>"));
  const coated = shader.fragmentShader.match(/#ifdef USE_CLEARCOAT\n  if \(rhineLookSatin[\s\S]*?#endif/);
  assert(coated, "Clearcoat-only fields are inside their feature guard");
  assert.equal((coated[0].match(/material\.clearcoat/g) || []).length, (shader.fragmentShader.match(/material\.clearcoat/g) || []).length - (fragment.match(/material\.clearcoat/g) || []).length);
  for (const coating of [0, 1, 2, 3, 0]) {
    state.coating.value = coating; state.color.value.set("#12a594"); state.amount.value = .7; clarity.value = 1;
    assert.equal(shader.uniforms.rhineModelLookCoating.value, coating);
    assert.equal(material.customProgramCacheKey(), programKey, "Changing coating does not create shader variants");
    assert.equal(material.version, version, "No needsUpdate/define change is required");
    assert.deepEqual(physicalState(material), original, "Optical volume and physical source properties remain unchanged");
  }
}

// Cover color remains independent of the calibrated glass reveal shader.
const cover = new THREE.MeshPhysicalMaterial({ transmission: .9, thickness: .12, ior: 1.46 });
const coverOriginal = physicalState(cover), clarity = { value: 0 };
const coverLook = applyModelLookMaterial(cover, "Frosted_Polymer", false, clarity);
const coverShader = makeShader();cover.onBeforeCompile(coverShader, null);
assert.equal(coverShader.vertexShader, vertex, "Ordinary meshes need no vertex code changes");
assert(!coverShader.fragmentShader.includes("roughnessFactor = max(roughnessFactor, 0.64)"));
assert(!coverShader.fragmentShader.includes("metalnessFactor = max(metalnessFactor"));
assert(coverShader.fragmentShader.includes("mix(0.86, 0.1 + 0.24 * rhineLookGrazing, rhineLookClear)"));
for (const value of [0, .25, .5, 1]) {
  clarity.value = value;
  assert.equal(coverShader.uniforms.rhineModelLookClarity.value, value);
  assert.deepEqual(physicalState(cover), coverOriginal);
}
assert.equal(coverLook.clarity, clarity);

// Instanced color needs only read-only varyings; no position or matrix changes.
const batch = new THREE.MeshPhysicalMaterial();
const batchState = applyModelLookMaterial(batch, "Ivory_Edges", true);
const batchShader = makeShader();batch.onBeforeCompile(batchShader, null);
assert(batchState);
assert(batchShader.vertexShader.includes("attribute vec3 modelLookColor;"));
assert(batchShader.vertexShader.includes("attribute float modelLookAmount;"));
assert(batchShader.vertexShader.includes("vRhineModelLookColor = modelLookColor;"));
assert(batchShader.fragmentShader.includes("clamp(vRhineModelLookAmount, 0.0, 1.0)"));
const strip = batchShader.vertexShader
  .replace("attribute vec3 modelLookColor;\nattribute float modelLookAmount;\nvarying vec3 vRhineModelLookColor;\nvarying float vRhineModelLookAmount;\n", "")
  .replace("\nvRhineModelLookColor = modelLookColor;\nvRhineModelLookAmount = modelLookAmount;", "");
assert.equal(strip, vertex, "Instancing does not alter any vertex, geometry or transform calculations");

for (const name of ["Printed_Label", "Printed_Canvas", "Carbon_Ink", "Case_Engraving", "Moulded_Lettering", "Unknown_Surface"]) {
  const material = new THREE.MeshPhysicalMaterial();
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  assert.equal(applyModelLookMaterial(material, name), undefined);
  assert.equal(material.onBeforeCompile, before);
  assert.equal(material.customProgramCacheKey(), key);
}
assert.equal(applyModelLookMaterial(new THREE.MeshBasicMaterial(), "Frosted_Polymer"), undefined);
console.log("Model look materials: composed hooks, live uniforms, stable programs, protected glass/labels, fixed geometry and physical baselines passed.");
