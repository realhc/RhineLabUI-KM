import assert from "node:assert/strict";
import * as THREE from "three";
import { finishMaterial } from "../src/material-finish.ts";
import { CardAppearance } from "../src/appearance.ts";
import { themeMaterial } from "../src/theme-material.ts";

const material = new THREE.MeshPhysicalMaterial({
  color: "#d8c7b5", roughness: 0.26, transmission: 0, thickness: 0.04, ior: 1.46,
});
const baseline = material.clone();
let previousCompiles = 0;
material.onBeforeCompile = shader => {
  previousCompiles++;
  shader.uniforms.priorOptics = { value: 42 };
};
const theme = themeMaterial(material, "Optical_Edges");
const quality = { value: 0.75 }, clarity = { value: 0.5 };
assert.equal(finishMaterial(material, "Optical_Edges", quality, clarity), true);
const key = material.customProgramCacheKey();
assert.ok(key.includes("rhine-theme-Optical_Edges-false"));
assert.ok(key.endsWith("archive-finish-v1-Optical_Edges"));
const shader = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
};
material.onBeforeCompile(shader, null);
assert.equal(previousCompiles, 1, "Existing optical hook must still run exactly once");
assert.equal(shader.uniforms.priorOptics.value, 42);
assert.equal(shader.uniforms.rhineTheme, theme, "Theme state remains live through finish compilation");
assert.equal(shader.uniforms.archiveFinishQuality, quality);
assert.equal(shader.uniforms.archiveFinishClarity, clarity);
assert.equal(material.thickness, baseline.thickness);
assert.equal(material.ior, baseline.ior);
assert.equal(material.transmission, baseline.transmission);
assert.equal(material.roughness, baseline.roughness);
assert.equal(material.transparent, baseline.transparent ?? false);
assert.ok(shader.vertexShader.includes("#include <begin_vertex>\nvArchiveFinishPosition = position;"));
assert.ok(shader.fragmentShader.includes("dFdx(vArchiveFinishPosition.xy)"));
assert.ok(shader.fragmentShader.includes("archiveReadEnvelope"));
assert.ok(shader.fragmentShader.includes("archiveFilmGrazing"));

// The outer cover's calibrated blur endpoints and existing uniforms must not
// be wrapped by the material detail feature at any appearance or clarity.
const appearance = new CardAppearance();
const cover = new THREE.MeshPhysicalMaterial({ transmission: 0.9, thickness: 0.12 });
const inside = new THREE.MeshPhysicalMaterial({ color: "#d8c7b5", roughness: 0.26 });
appearance.register("Frosted_Polymer", cover, cover.clone());
appearance.register("Optical_Edges", inside);
const group = new THREE.Group();
for (const [name, source] of [["Frosted_Polymer", cover], ["Optical_Edges", inside]]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), source);
  mesh.userData.surface = name; group.add(mesh);
}
appearance.prepare(group); appearance.apply(group, 1);
const shaders = group.children.map(mesh => {
  const source = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mesh.material.onBeforeCompile(source, null); return source;
});
assert.equal(shaders[0].uniforms.archiveFinishClarity, undefined);
assert.ok(shaders[0].fragmentShader.includes("roughnessFactor = mix(mix(0.28, 0.42, archiveQuality), 0.025"));
const parts = new THREE.Group(); group.add(parts); parts.add(group.children[1]);
for (const value of [0, 0.25, 0.5, 0.75, 1]) {
  appearance.setClarity(group, value);
  assert.equal(shaders[1].uniforms.archiveFinishClarity.value, value, "Viewer reparenting keeps the existing decryption state");
  assert.equal(shaders[0].uniforms.archiveClarity.value, value);
}
const unsupported = new THREE.MeshBasicMaterial();
const before = unsupported.onBeforeCompile;
const programKey = unsupported.customProgramCacheKey();
assert.equal(finishMaterial(unsupported, "Printed_Canvas"), false);
assert.equal(finishMaterial(cover, "Frosted_Polymer"), false);
assert.equal(unsupported.onBeforeCompile, before);
assert.equal(unsupported.customProgramCacheKey(), programKey);

// Array detail uses constant uniforms and has no background animation source.
const array = inside.clone();
assert.equal(finishMaterial(array, "Titanium_Fasteners", { value: 0.2 }), true);
const arrayShader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
array.onBeforeCompile(arrayShader, null);
assert.equal(arrayShader.uniforms.archiveFinishClarity.value, 1);
assert.ok(!arrayShader.fragmentShader.includes("archiveReadEnvelope"));
assert.ok(!arrayShader.fragmentShader.includes("archiveFilmGrazing"));
console.log("Procedural material hook composition, unchanged physical properties, reveal endpoints and viewer state: passed");
