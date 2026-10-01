/** Native scrolling remains authoritative; perspective only changes the row's presentation. */
export function mountDirectoryWheel(list: HTMLElement, wantsMomentum: () => boolean = () => true) {
  let frame = 0;
  let motionFrame = 0, velocity = 0, motionPosition = 0, expectedScroll = 0, lastMotion = 0;
  let nativeWheelUntil = 0;
  const decayTime = 180;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const momentumEnabled = () => wantsMomentum() && !reduced.matches;
  type Sample = {time:number; scroll:number};
  let pointer: {id:number; y:number; scroll:number; moved:boolean; samples:Sample[]} | undefined;
  let suppressClick = false;
  let motionFrames = 0;
  list.dataset.wheelState = 'idle';
  list.dataset.motionFrames = '0';
  const setWheelState = (state:'idle'|'dragging'|'coasting') => {
    if (list.dataset.wheelState === state) return;
    list.dataset.wheelState = state;
    list.classList.toggle('wheel-coasting', state === 'coasting');
  };
  const stopMomentum = () => {
    if (motionFrame) cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    velocity = 0;
    setWheelState(pointer?.moved ? 'dragging' : 'idle');
  };
  const cancelPointer = () => {
    const active = pointer;
    pointer = undefined;
    if (!active) return;
    list.classList.remove('wheel-dragging');
    setWheelState('idle');
    if (active?.moved) suppressClick = true;
    if (active && list.hasPointerCapture(active.id)) list.releasePointerCapture(active.id);
  };
  const stop = () => { stopMomentum(); cancelPointer(); };
  const animateMomentum = (now:number) => {
    motionFrame = 0;
    if (!momentumEnabled() || document.hidden || !list.isConnected || !list.clientHeight) { stopMomentum(); return; }
    if (Math.abs(list.scrollTop - expectedScroll) > 1) { stopMomentum(); return; }
    list.dataset.motionFrames = String(++motionFrames);
    const elapsed = Math.max(0, Math.min(64, now - lastMotion));
    lastMotion = now;
    const decay = Math.exp(-elapsed / decayTime);
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    motionPosition = Math.max(0, Math.min(maxScroll, motionPosition + velocity * decayTime * (1 - decay)));
    list.scrollTop = motionPosition;
    expectedScroll = list.scrollTop;
    velocity *= decay;
    if ((motionPosition === 0 && velocity < 0) || (motionPosition === maxScroll && velocity > 0)) { stopMomentum(); return; }
    if (Math.abs(velocity) < .01) {
      list.scrollTop = Math.max(0, Math.min(maxScroll, motionPosition + velocity * decayTime));
      expectedScroll = list.scrollTop;
      stopMomentum();
      return;
    }
    motionFrame = requestAnimationFrame(animateMomentum);
  };
  const beginMomentum = (speed:number) => {
    stopMomentum();
    if (!momentumEnabled() || Math.abs(speed) < .01) return;
    velocity = speed;
    motionPosition = expectedScroll = list.scrollTop;
    lastMotion = performance.now();
    setWheelState('coasting');
    motionFrame = requestAnimationFrame(animateMomentum);
  };
  const painted = new WeakMap<HTMLElement, string>();
  const paint = () => {
    frame = 0;
    const height = list.clientHeight;
    if (!height) return;
    const top = list.getBoundingClientRect().top;
    // Read all row positions before applying styles, so a long directory does not
    // force a style/layout flush between every pair of rows while scrolling.
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.document'), row => ({
      row, box: row.getBoundingClientRect(),
    }));
    for (const {row, box} of rows) {
      const distance = Math.min(1, Math.abs((box.top + box.height / 2 - top - height / 2) / (height / 2)));
      const depth = Math.cos(distance * Math.PI / 2);
      const scale = (0.85 + depth * 0.15).toFixed(3);
      const opacity = (0.58 + depth * 0.42).toFixed(3);
      const length = `${(19 + depth * 15).toFixed(2)}px`;
      const signature = `${scale}/${opacity}/${length}`;
      if (painted.get(row) === signature) continue;
      row.style.setProperty('--wheel-scale', scale);
      row.style.setProperty('--wheel-opacity', opacity);
      row.style.setProperty('--tick-length', length);
      painted.set(row, signature);
    }
  };
  const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint); };
  // Public refresh is a data/selection change; internal scroll paints must not
  // cancel the animation that caused that scroll event.
  const refresh = () => { stop(); schedulePaint(); };
  list.addEventListener('scroll', () => {
    if (velocity && Math.abs(list.scrollTop - expectedScroll) > 1) stopMomentum();
    schedulePaint();
  }, {passive:true});
  new ResizeObserver(refresh).observe(list);
  new MutationObserver(refresh).observe(list, {childList:true, subtree:true});
  reduced.addEventListener('change', stop);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pointerdown', stopMomentum, {capture:true, passive:true});
  window.addEventListener('mousemove', event => { if (event.buttons && !pointer) stopMomentum(); }, {passive:true});
  window.addEventListener('keydown', stopMomentum, {capture:true});
  window.addEventListener('wheel', event => {
    if (!(event.target instanceof Node) || !list.contains(event.target)) stopMomentum();
  }, {capture:true, passive:true});
  list.addEventListener('dragstart', stop, {capture:true});
  list.addEventListener('wheel', event => {
    cancelPointer();
    const now = performance.now();
    // Pixel streams with small/fractional deltas or multiple axes normally come
    // from a touchpad, which already supplies OS inertia. Leave that stream native.
    const finePixels = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
      (Math.abs(event.deltaY) < 45 || !Number.isInteger(event.deltaY) || !!event.deltaX);
    if (finePixels) nativeWheelUntil = now + 220;
    if (!event.deltaY || event.ctrlKey || event.metaKey || !momentumEnabled() || finePixels || now < nativeWheelUntil) {
      stopMomentum();
      return;
    }
    const style = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? getComputedStyle(list) : null;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientHeight :
      style ? parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 20 : 1;
    const delta = event.deltaY * unit;
    const previousSpeed = velocity && Math.sign(velocity) === Math.sign(delta) ? velocity : 0;
    stopMomentum();
    event.preventDefault();
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(maxScroll, list.scrollTop + delta * .32));
    if ((list.scrollTop === 0 && delta < 0) || (list.scrollTop === maxScroll && delta > 0)) return;
    beginMomentum(previousSpeed + delta * .68 / decayTime);
  }, {passive:false});
  list.addEventListener('pointerdown', event => {
    stop();
    suppressClick = false;
    if (event.button !== 0 || (event.target as HTMLElement).closest('.document,[data-category-id]')) return;
    pointer = {id:event.pointerId, y:event.clientY, scroll:list.scrollTop, moved:false, samples:[{time:performance.now(), scroll:list.scrollTop}]};
  });
  list.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const delta = event.clientY - pointer.y;
    if (!pointer.moved && Math.abs(delta) < 5) return;
    pointer.moved = true;
    setWheelState('dragging');
    list.setPointerCapture(event.pointerId);
    list.classList.add('wheel-dragging');
    list.scrollTop = pointer.scroll - delta;
    const now = performance.now();
    pointer.samples.push({time:now, scroll:list.scrollTop});
    while (pointer.samples.length > 2 && pointer.samples[0].time < now - 100) pointer.samples.shift();
    event.preventDefault();
  });
  const finish = (event: PointerEvent, releaseMomentum = true) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const active = pointer;
    suppressClick = active.moved;
    pointer = undefined;
    list.classList.remove('wheel-dragging');
    setWheelState('idle');
    if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
    if (!releaseMomentum || !active.moved) return;
    const first = active.samples[0], last = active.samples[active.samples.length - 1];
    if (performance.now() - last.time > 80 || last.time - first.time < 12) return;
    beginMomentum((last.scroll - first.scroll) / (last.time - first.time));
  };
  list.addEventListener('pointerup', event => finish(event));
  list.addEventListener('pointercancel', event => { finish(event, false); stopMomentum(); });
  list.addEventListener('lostpointercapture', () => {
    // A normal release clears pointer before releasing capture. An unexpected
    // loss must not create a fling or leave the dragging cursor behind.
    if (pointer) stop();
  });
  list.addEventListener('click', event => {
    if (suppressClick || (event.target as HTMLElement).closest('.directory-reorder')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    }
  }, true);
  list.addEventListener('keydown', event => {
    stop();
    suppressClick = false;
    if (!['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('.document'));
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const page = Math.max(1, Math.floor(list.clientHeight / 60));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : current + (event.key === 'PageDown' ? page : event.key === 'PageUp' ? -page : event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
    row.focus({preventScroll:true});
    row.scrollIntoView({block:'nearest'});
  });
  refresh();
  return {refresh, stop};
}
