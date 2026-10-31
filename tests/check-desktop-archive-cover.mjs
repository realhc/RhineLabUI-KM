import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real browser Canvas and Three resources, with an in-memory library and IPC stub.
// No user data, server, generated source files or browser download is needed.
const evidence = resolve('verification/research');
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: { contents: `
    import * as THREE from 'three';
    import {ModelImages} from './src/model-images.ts';
    import {createArchiveCover,archiveCoverKey,coverTextLines} from './src/archive-cover.ts';
    import {archiveIdentity} from './src/archive-identity.ts';
    import {setDesktopDocuments,records} from './src/desktop-data.ts';
    window.coverCheck={THREE,ModelImages,createArchiveCover,archiveCoverKey,coverTextLines,archiveIdentity,setDesktopDocuments,records};
  `, resolveDir: process.cwd(), sourcefile: 'cover-check.ts', loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent',
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 780 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#fdfdfc;color:#21201c;font:14px "Microsoft YaHei",sans-serif}h1{font-size:18px;margin:0 0 20px}.samples{display:flex;gap:24px}figure{margin:0;width:360px}canvas{width:360px;height:auto;display:block}figcaption{margin-top:12px}</style><h1>脚本生成封面 / 验收样片</h1><div class="samples"></div></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const checks = await page.evaluate(async () => {
    const { THREE, ModelImages, createArchiveCover, archiveCoverKey, coverTextLines, archiveIdentity, setDesktopDocuments } = window.coverCheck;
    const ok = (value, message) => { if (!value) throw Error(message); };
    const result = {};
    const base = { id: 'research-a-0123456789', title: '空间中的知识如何连接', category: '研究方法' };
    const generated = createArchiveCover(base, 512);
    ok(generated.width === 512 && generated.height === Math.round(512 * 3.05 / 2.65), 'cover proportions');
    ok(generated.toDataURL() === createArchiveCover(base, 512).toDataURL(), 'same document must produce the same pixels');
    for (const change of [{ title: '标题发生变化' }, { category: '实验记录' }, { id: 'another-stable-id' }]) {
      ok(archiveCoverKey(base) !== archiveCoverKey({ ...base, ...change }), 'key must include visible identity');
      ok(generated.toDataURL() !== createArchiveCover({ ...base, ...change }, 512).toDataURL(), 'identity change must update print');
    }
    const ctx = generated.getContext('2d'); ctx.font = '600 36px "Microsoft YaHei"';
    const lines = coverTextLines(ctx, '非常长的中文标题以及连续英文ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12), 432, 4);
    ok(lines.length === 4 && lines.at(-1).endsWith('…') && lines.every(line => ctx.measureText(line).width <= 432), 'long titles fit and truncate');
    ok(archiveIdentity(base).mark === archiveIdentity({ ...base, id: 'different' }).mark, 'category mark is consistent across documents');
    result.deterministicIdentityAndTypography = true;

    let reads = 0, invalidations = 0, resolveSlow;
    const custom = document.createElement('canvas'); custom.width = custom.height = 32;
    custom.getContext('2d').fillStyle = '#ff0000'; custom.getContext('2d').fillRect(0, 0, 32, 32);
    const customUrl = custom.toDataURL();
    window.rhine = { readModelImage: async (_id, reference) => {
      reads++;
      if (reference === 'slow.png') return await new Promise(resolve => { resolveSlow = resolve; });
      if (reference === 'broken.png') throw Error('fixture image unavailable');
      return customUrl;
    } };
    const model = new ModelImages(() => invalidations++, 16), group = new THREE.Group();
    group.add(new THREE.Group());
    const print = () => group.children.find(child => child.userData.modelImage);
    await model.select(group, base);
    ok(reads === 0 && model.stats().selectedSource === 'generated' && print().material.map.image.width === 1024, 'generated selected cover');
    const generatedMap = print().material.map; let replacedDisposed = 0;
    generatedMap.addEventListener('dispose', () => replacedDisposed++);
    const customDoc = { ...base, modelImage: 'custom.png' };
    await model.select(group, customDoc);
    ok(reads === 1 && model.stats().selectedSource === 'custom' && !print().userData.generatedCover, 'custom image has priority');
    ok(replacedDisposed === 1, 'replaced generated texture is released');
    const image = print().material.map.image, pixels = image.getContext('2d');
    ok(pixels.getImageData(512, 100, 1, 1).data[0] === 255 && pixels.getImageData(512, image.height - 1, 1, 1).data[3] === 0, 'custom aspect ratio retained');
    const cloned = group.clone(true); model.snapshot(cloned);
    const oldPrint = print(), clonePrint = cloned.children.find(child => child.userData.modelImage);
    ok(clonePrint.material !== oldPrint.material && clonePrint.material.map !== oldPrint.material.map, 'returning snapshot owns texture handles');
    let snapshotDisposed = 0; clonePrint.material.map.addEventListener('dispose', () => snapshotDisposed++);
    await model.select(group, base);
    ok(snapshotDisposed === 0 && model.stats().selectedSource === 'generated', 'removing custom restores generated cover without invalidating snapshot');
    clonePrint.material.map.dispose(); clonePrint.material.dispose();
    const assembly = await model.assembly(base);
    ok(assembly.userData.generatedCover && assembly.userData.assemblyPart === 'cover' && assembly.material.map.image.width === 1024, 'viewer uses generated cover');
    assembly.material.map.dispose(); assembly.material.dispose(); assembly.geometry.dispose();
    await model.select(group, { ...base, placeholder: true });
    ok(!print() && model.stats().selectedSource === 'none', 'placeholder never claims a document print');
    result.customPrioritySnapshotAndViewer = true;

    let allDisposed = 0;
    const originalDispose = THREE.Texture.prototype.dispose;
    THREE.Texture.prototype.dispose = function () { allDisposed++; return originalDispose.call(this); };
    const slow = model.select(group, { ...base, modelImage: 'slow.png' });
    await model.select(group, { ...base, id: 'new-selection' });
    const beforeLate = allDisposed;
    resolveSlow(customUrl); await slow;
    ok(model.stats().selected.startsWith('new-selection:generated:') && print().userData.generatedCover, 'late custom request cannot replace new selection');
    ok(allDisposed === beforeLate + 1, 'late texture released');
    await model.select(group, undefined); model.dispose();
    THREE.Texture.prototype.dispose = originalDispose;
    result.staleRequestsDisposed = true;

    const docs = Array.from({ length: 36 }, (_, i) => ({ id: `cover-${i}`, title: `测试档案 ${i}`, category: '研究', categoryId: 'cover-category', body: '', order: i, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', revision: String(i) }));
    setDesktopDocuments(docs, [{ id: 'cover-category', name: '研究', lane: 0 }], 1);
    const cells = docs.map((_, i) => ({ lane: 0, row: 12 + i }));
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 16), 16);
    cells.forEach((_, i) => new THREE.Matrix4().identity().toArray(matrices.array, i * 16));
    const batchModel = new ModelImages(() => invalidations++, 4);
    batchModel.update(cells, matrices);
    ok(batchModel.stats().pending <= 3, 'bounded concurrent work');
    for (let i = 0; i < 100 && batchModel.stats().batches < docs.length; i++) { await new Promise(resolve => setTimeout(resolve, 10)); batchModel.update(cells, matrices); }
    ok(batchModel.stats().visibleDocuments === 36 && batchModel.stats().generatedBatches === 36, 'all visible documents acquire generated prints');
    const batchTextures = batchModel.array.children.map(mesh => mesh.material.map); let batchDisposed = 0;
    batchTextures.forEach(texture => texture.addEventListener('dispose', () => batchDisposed++));
    batchModel.update([cells[0]], matrices);
    ok(batchModel.stats().batches === 32 && batchDisposed === 4, 'inactive cache is bounded and evicted textures released');
    batchModel.dispose();
    ok(batchDisposed === 36 && batchModel.array.children.length === 0, 'all cached textures released on disposal');
    batchModel.update(cells, matrices);
    ok(batchModel.stats().pending === 0 && batchModel.stats().batches === 0, 'disposed model cannot reload prints');
    result.arrayQueueCacheAndDisposal = true;

    // A failed batch must release its queue slot and request another frame.
    setDesktopDocuments(docs.slice(0, 4).map((doc, i) => i < 3 ? { ...doc, modelImage: 'broken.png' } : doc), [{ id: 'cover-category', name: '研究', lane: 0 }], 1);
    let wake = 0; const failureModel = new ModelImages(() => wake++, 4);
    failureModel.update(cells.slice(0, 4), matrices);
    await new Promise(resolve => setTimeout(resolve, 20));
    ok(wake === 3 && failureModel.stats().pending === 0, 'failed work wakes next queued batch');
    for (let i = 0; i < 15 && failureModel.stats().batches < 1; i++) { failureModel.update(cells.slice(0, 4), matrices); await new Promise(resolve => setTimeout(resolve, 10)); }
    ok(failureModel.stats().generatedBatches === 1, 'valid cover after failed images is not starved'); failureModel.dispose();
    result.failureDoesNotStarveQueue = true;

    for (const [source, caption] of [[base, '文档标题、分类与稳定编号'], [{ ...base, id: 'archive-042', category: '实验记录', title: '研究日志与材料分析' }, '同一套网格与分类符号'], [{ ...base, id: 'archive-043', title: '面向复杂问题的长期研究与知识关联记录' }, '长标题自动换行']]) {
      const figure = document.createElement('figure'), canvas = createArchiveCover(source, 512), label = document.createElement('figcaption');
      label.textContent = caption; figure.append(canvas, label); document.querySelector('.samples').append(figure);
    }
    return result;
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidence, 'generated-covers.png') });
  await writeFile(join(evidence, 'archive-cover-result.json'), JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log(JSON.stringify(checks));
} finally { await browser.close(); }
