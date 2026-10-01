import assert from "node:assert/strict";
import { viewportLayout, openingLayout, archiveFraming } from "../src/viewport-layout.ts";
import { renderDimensions, qualityPresets } from "../src/render-quality.ts";

for (const [w,h,touch] of [[1920,1080,false],[2560,1080,false],[1280,1024,false],[1000,680,false],[1440,900,false],[3840,2160,false]]) {
  const layout=viewportLayout(w,h,touch);
  assert.ok(Math.abs(layout.width*layout.scale-w)<1e-8);
  assert.ok(Math.abs(layout.height*layout.scale-h)<1e-8);
  const film=viewportLayout(w,h,touch,true);
  const opening=openingLayout(w,h);
  assert.ok(Math.abs(opening.width*opening.scale-w)<1e-8 && Math.abs(opening.height*opening.scale-h)<1e-8,'Opening fills the viewport');
  assert.ok(opening.width>=1279.99 && opening.height>=1079.99,'Central login content fits without stretching');
  assert.equal(film.width/film.height,16/9);
  assert.ok(film.width*film.scale<=w+.001&&film.height*film.scale<=h+.001);
  const shot=archiveFraming(layout.width,layout.height,7.33,1,layout.kind==='compact');
  assert.ok(shot.span>=5.9&&shot.detailX>0&&shot.detailX<1&&shot.detailY>0&&shot.detailY<1);

  const render=renderDimensions(qualityPresets.original,layout.width,layout.height,layout.scale,3,16384);
  assert.ok(render.width>=w, 'Rendered output follows the client viewport without an obsolete fixed scale');
  assert.ok(render.width*render.height<=8294400+5000);
}
assert.deepEqual(viewportLayout(1920,1080,false),{width:1920,height:1080,scale:1,kind:'desktop'});
assert.equal(archiveFraming(1920,1080,7.33,1,false).span,5.9);
assert.equal(archiveFraming(1920,1080,7.33,1,false).detailX,550/1920);
console.log('Client viewport, opening framing and render resolution checks passed.');
