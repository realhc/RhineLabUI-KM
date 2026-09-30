/** Native scrolling remains authoritative; perspective only changes the row's presentation. */
export function mountDirectoryWheel(list: HTMLElement) {
  let frame = 0;
  const paint = () => {
    frame = 0;
    const height = list.clientHeight;
    if (!height) return;
    const top = list.getBoundingClientRect().top;
    for (const row of list.querySelectorAll<HTMLElement>('.document')) {
      const box = row.getBoundingClientRect();
      const distance = Math.min(1, Math.abs((box.top + box.height / 2 - top - height / 2) / (height / 2)));
      const depth = Math.cos(distance * Math.PI / 2);
      row.style.setProperty('--wheel-scale', (0.85 + depth * 0.15).toFixed(3));
      row.style.setProperty('--wheel-opacity', (0.58 + depth * 0.42).toFixed(3));
      row.style.setProperty('--tick-length', `${19 + depth * 15}px`);
    }
  };
  const refresh = () => { if (!frame) frame = requestAnimationFrame(paint); };
  list.addEventListener('scroll', refresh, {passive:true});
  new ResizeObserver(refresh).observe(list);
  let pointer: {id:number; y:number; scroll:number; moved:boolean} | undefined;
  let suppressClick = false;
  list.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.directory-reorder')) return;
    suppressClick = false;
    pointer = {id:event.pointerId, y:event.clientY, scroll:list.scrollTop, moved:false};
  });
  list.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const delta = event.clientY - pointer.y;
    if (!pointer.moved && Math.abs(delta) < 5) return;
    pointer.moved = true;
    list.setPointerCapture(event.pointerId);
    list.classList.add('wheel-dragging');
    list.scrollTop = pointer.scroll - delta;
    event.preventDefault();
  });
  const finish = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    suppressClick = pointer.moved;
    pointer = undefined;
    list.classList.remove('wheel-dragging');
    if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
  list.addEventListener('lostpointercapture', () => {
    pointer = undefined;
    list.classList.remove('wheel-dragging');
  });
  list.addEventListener('click', event => {
    if (suppressClick || (event.target as HTMLElement).closest('.directory-reorder')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    }
  }, true);
  list.addEventListener('keydown', event => {
    suppressClick = false;
    if (!['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('.document'));
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const page = Math.max(1, Math.floor(list.clientHeight / 78));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : current + (event.key === 'PageDown' ? page : event.key === 'PageUp' ? -page : event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
    row.focus({preventScroll:true});
    row.scrollIntoView({block:'nearest'});
  });
  refresh();
  return {refresh};
}
