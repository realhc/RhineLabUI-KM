import * as THREE from "three";
import { defaultModelLook, normalizeModelLook, modelLookKey, modelLookColor, type ModelLookPreferences } from "./model-look.ts";
import type { ModelLookMaterialState } from "./model-look-material.ts";

type LookDocument = { id: string; category?: string; placeholder?: boolean };
type ResolvedLook = { color: THREE.Color; amount: number };
const coats = { natural: 0, satin: 1, metal: 2, pearl: 3 } as const;

/** Resolve only when preferences or document identity change, never per-pixel or per frame. */
export class ModelLookRuntime {
  private config = defaultModelLook();
  private saved = new Set<string>();
  private signature = "";
  private cache = new Map<string, ResolvedLook>();
  private neutral: ResolvedLook = { color: new THREE.Color(1, 1, 1), amount: 0 };
  get coating() { return coats[this.config.coating]; }
  get key() { return this.signature; }
  configure(input: ModelLookPreferences, saved: Iterable<string>) {
    const config = normalizeModelLook(input), ids = [...new Set(saved)].sort();
    const signature = modelLookKey(config) + JSON.stringify(ids);
    if (signature === this.signature) return false;
    this.config = config; this.saved = new Set(ids); this.signature = signature; this.cache.clear();
    return true;
  }
  resolve(doc?: LookDocument): ResolvedLook {
    if (!doc || doc.placeholder) return this.neutral;
    const key = doc.id + "\0" + (doc.category || "");
    let look = this.cache.get(key);
    if (!look) {
      const hex = modelLookColor(this.config, doc, this.saved.has(doc.id));
      look = hex ? { color: new THREE.Color(hex), amount: this.config.strength } : this.neutral;
      // A moving array must not retain all documents ever visited.
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, look);
    }
    return look;
  }
  applyGroup(group: THREE.Group, doc?: LookDocument) {
    if (doc) group.userData.modelLookDocument = { id: doc.id, category: doc.category, placeholder: doc.placeholder };
    const look = this.resolve(doc ?? group.userData.modelLookDocument);
    group.traverse(child => {
      const state = child.userData.modelLook as ModelLookMaterialState | undefined;
      if (!state) return;
      state.color.value.copy(look.color); state.amount.value = look.amount; state.coating.value = this.coating;
    });
  }
}
