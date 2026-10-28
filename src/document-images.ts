import "./document-images.css";

export const isDocumentImageSource = (src: unknown): src is string =>
  typeof src === "string" && /^\.\.\/assets\/document-images\/[a-f0-9]{64}\.(png|jpg)$/.test(src);

// Share small previews between the reader, editor and undo history without
// retaining every image ever visited. The files remain the source of truth.
const previews = new Map<string, string>();
const requests = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let activeReads = 0;
async function readImage(id: string, src: string) {
  if (activeReads >= 3) await new Promise<void>(resolve => waiting.push(resolve));
  else activeReads++;
  try { return await window.rhine.readDocumentImage(id, src); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else activeReads--;
  }
}
let cachedCharacters = 0;
const CACHE_CHARACTERS = 64 * 1024 * 1024;
function cached(key: string) {
  const value = previews.get(key);
  if (value) { previews.delete(key); previews.set(key, value); }
  return value;
}
export function cacheDocumentImage(id: string, src: string, dataUrl: string) {
  const mime = src.endsWith(".jpg") ? "jpeg" : "png";
  if (!isDocumentImageSource(src) || !dataUrl.startsWith(`data:image/${mime};base64,`))
    throw new Error("图片引用无效。");
  const key = id + ":" + src;
  const previous = previews.get(key);
  if (previous) cachedCharacters -= previous.length;
  previews.delete(key);
  previews.set(key, dataUrl);
  cachedCharacters += dataUrl.length;
  while (previews.size > 16 || cachedCharacters > CACHE_CHARACTERS) {
    const oldest = previews.keys().next().value!;
    cachedCharacters -= previews.get(oldest)!.length;
    previews.delete(oldest);
  }
}
export function loadDocumentImage(id: string, src: string): Promise<string> {
  if (!isDocumentImageSource(src)) return Promise.reject(new Error("图片引用无效。"));
  const key = id + ":" + src;
  const preview = cached(key);
  if (preview) return Promise.resolve(preview);
  let request = requests.get(key);
  if (!request) {
    request = readImage(id, src).then(url => {
      cacheDocumentImage(id, src, url);
      return url;
    }).finally(() => requests.delete(key));
    requests.set(key, request);
  }
  return request;
}

const hydrating = new WeakSet<HTMLElement>();
export function hydrateDocumentImages(root: HTMLElement, id: string, loaded?: () => void) {
  for (const wrapper of root.querySelectorAll<HTMLElement>("[data-document-image]")) {
    const src = wrapper.dataset.documentImage;
    if (!isDocumentImageSource(src) || hydrating.has(wrapper)) continue;
    hydrating.add(wrapper);
    void loadDocumentImage(id, src).then(url => {
      if (!wrapper.isConnected || !root.contains(wrapper)) return;
      const img = document.createElement("img");
      img.className = "document-image-content";
      img.alt = wrapper.dataset.alt || "图片";
      img.loading = "lazy";
      img.decoding = "async";
      if (wrapper.dataset.title) img.title = wrapper.dataset.title;
      img.addEventListener("load", () => loaded?.(), { once: true });
      img.src = url;
      wrapper.replaceChildren(img);
      wrapper.removeAttribute("aria-busy");
    }).catch(() => {
      if (!wrapper.isConnected) return;
      wrapper.textContent = "图片无法读取";
      wrapper.classList.add("document-image-error");
      wrapper.removeAttribute("aria-busy");
    });
  }
}
