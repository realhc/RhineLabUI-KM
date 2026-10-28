import * as THREE from "three";
import { InstanceUpdates } from "./instance-updates";
import { records, type ArchiveRecord } from "./desktop-data";
import { fileAtCell, type ArchiveCell } from "./archive-loop";

// A print on the existing cover. Keep the label, frame and cassette geometry.
const WIDTH = 2.65, HEIGHT = 3.05;
const geometry = () => new THREE.PlaneGeometry(WIDTH, HEIGHT).translate(0.625, 1.975, 0.25);
type Batch = { mesh: THREE.InstancedMesh; updates: InstanceUpdates; used: number };
type Picture = Pick<ArchiveRecord, "id" | "modelImage">;

function textureFor(image: HTMLImageElement, width: number, anisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width * HEIGHT / WIDTH);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  // Align to the top of the print window: the upper edge remains visible
  // between tightly packed rows, while the original label stays unobstructed.
  canvas.getContext("2d")!.drawImage(image, (canvas.width - w) / 2, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, anisotropy);
  return texture;
}
function materialFor(texture: THREE.Texture) {
  // Cutout prints participate in the opaque capture used by physical glass.
  return new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.025, toneMapped: false });
}
async function loadImage(doc: Picture) {
  const url = await window.rhine.readModelImage(doc.id, doc.modelImage!);
  if (!url) throw new Error("模型图片不可用");
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export class ModelImages {
  readonly array = new THREE.Group();
  private plane = geometry();
  private batches = new Map<string, Batch>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private wanted = new Set<string>();
  private selectedKey = "";
  private selectedReady = false;
  private selectedLoading = false;
  private selectedRequest = 0;
  private disposed = false;
  private frame = 0;
  constructor(private invalidate: () => void, private anisotropy: number) {
    this.array.name = "archive-model-images";
  }
  private key(doc?: Picture) { return doc?.modelImage ? doc.id + ":" + doc.modelImage : ""; }
  private removePrint(group: THREE.Group) {
    for (const child of [...group.children]) {
      if (!child.userData.modelImage) continue;
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      group.remove(mesh);
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
  }
  async select(group: THREE.Group, doc?: Picture) {
    const key = this.key(doc);
    if (key === this.selectedKey && (this.selectedReady || this.selectedLoading || !key)) return;
    this.selectedKey = key;
    this.selectedReady = false;
    this.selectedLoading = !!key;
    group.userData.modelImageDocument = doc?.modelImage ? { id: doc.id, modelImage: doc.modelImage } : null;
    const ticket = ++this.selectedRequest;
    this.removePrint(group);
    this.invalidate();
    if (!key || !doc) return;
    try {
      const image = await loadImage(doc);
      if (this.disposed || ticket !== this.selectedRequest) return;
      const print = new THREE.Mesh(this.plane, materialFor(textureFor(image, 1024, this.anisotropy)));
      print.name = "model-image";
      print.userData.modelImage = key;
      group.add(print);
      // The existing label remains the last child used by returning snapshots.
      group.children.unshift(group.children.pop()!);
      this.selectedReady = true;
      this.invalidate();
    } catch (error) {
      if (!this.disposed && ticket === this.selectedRequest) console.warn("模型图片载入失败", error);
    } finally {
      if (ticket === this.selectedRequest) this.selectedLoading = false;
    }
  }
  // Returning cards own their texture handles, so changing the selected print
  // cannot mutate or dispose an image that is still moving back into its row.
  snapshot(group: THREE.Group) {
    let found = false;
    for (const child of group.children) {
      if (!child.userData.modelImage) continue;
      found = true;
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      mesh.material = mesh.material.clone();
      mesh.material.map = mesh.material.map!.clone();
      mesh.material.map.needsUpdate = true;
    }
    const doc = group.userData.modelImageDocument as Picture | null;
    if (!found && doc?.modelImage) {
      void loadImage(doc).then(image => {
        if (this.disposed || !group.parent) return;
        const print = new THREE.Mesh(this.plane, materialFor(textureFor(image, 1024, this.anisotropy)));
        print.userData.modelImage = this.key(doc);
        group.add(print);
        group.children.unshift(group.children.pop()!);
        this.invalidate();
      }).catch(() => {});
    }
  }
  async assembly(doc?: Picture) {
    if (!doc?.modelImage) return;
    try {
      const image = await loadImage(doc);
      const print = new THREE.Mesh(geometry(), materialFor(textureFor(image, 1024, this.anisotropy)));
      print.name = "model-image";
      print.userData.modelImage = this.key(doc);
      print.userData.assemblyPart = "cover";
      return print;
    } catch (error) { console.warn("模型图片载入失败", error); }
  }
  update(cells: ArchiveCell[], matrices: THREE.InstancedBufferAttribute) {
    this.frame++;
    const groups = new Map<string, { doc: ArchiveRecord; indices: number[] }>();
    cells.forEach((cell, i) => {
      const doc = records[fileAtCell(cell)], key = this.key(doc);
      if (!key) return;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { doc, indices: [] });
      group.indices.push(i);
    });
    this.wanted = new Set(groups.keys());
    for (const key of this.failed) if (!this.wanted.has(key)) this.failed.delete(key);
    for (const [key, batch] of this.batches) {
      const indices = groups.get(key)?.indices ?? [];
      batch.mesh.visible = !!indices.length;
      batch.mesh.count = indices.length;
      if (!indices.length) continue;
      batch.used = this.frame;
      if (indices.length > batch.mesh.instanceMatrix.count) {
        batch.mesh.dispose();
        batch.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(indices.length * 32), 16).setUsage(THREE.DynamicDrawUsage);
        batch.updates = new InstanceUpdates(batch.mesh.instanceMatrix);
      }
      indices.forEach((i, slot) => batch.updates.set(slot * 16, matrices.array.subarray(i * 16, i * 16 + 16)));
      batch.updates.commit();
    }
    for (const [key, { doc }] of groups) {
      if (this.batches.has(key) || this.pending.has(key) || this.failed.has(key)) continue;
      this.pending.add(key);
      void loadImage(doc).then(image => {
        if (this.disposed || !this.wanted.has(key)) return;
        const mesh = new THREE.InstancedMesh(this.plane, materialFor(textureFor(image, 512, this.anisotropy)), 16);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.name = "array-model-image";
        this.array.add(mesh);
        this.batches.set(key, { mesh, updates: new InstanceUpdates(mesh.instanceMatrix), used: this.frame });
        this.invalidate();
      }).catch(() => this.failed.add(key)).finally(() => this.pending.delete(key));
    }
    // Keep a bounded cache for nearby repeated rows without retaining the library.
    const unused = [...this.batches].filter(([key]) => !this.wanted.has(key)).sort((a, b) => a[1].used - b[1].used);
    for (const [key, batch] of unused) {
      if (this.batches.size <= Math.max(32, groups.size)) break;
      this.array.remove(batch.mesh);
      batch.mesh.dispose();
      (batch.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (batch.mesh.material as THREE.Material).dispose();
      this.batches.delete(key);
    }
  }
  stats() { return { selected: this.selectedKey, selectedReady: this.selectedReady, batches: this.batches.size, visible: [...this.batches.values()].reduce((sum, b) => sum + b.mesh.count, 0), pending: this.pending.size }; }
  dispose() {
    this.disposed = true;
    this.selectedRequest++;
    this.plane.dispose();
    this.batches.clear();
    this.pending.clear();
    this.failed.clear();
  }
}
