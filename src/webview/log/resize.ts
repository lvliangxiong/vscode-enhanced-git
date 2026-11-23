import { Lifetime } from './lifetime';
export function installJunctionResize(
  handle: HTMLElement,
  host: {
    measure(): { width: number; height: number };
    resize(width: number, height: number): void;
    collapse?(width: number): boolean;
    active(value: boolean): void;
    save(): void;
    reset(): void;
  },
) {
  const lifetime = new Lifetime();
  let drag: { x: number; y: number; width: number; height: number } | undefined;
  const finish = () => {
    if (!drag) return;
    drag = undefined;
    host.active(false);
    host.save();
  };
  lifetime.listen(handle, 'pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    drag = { x: event.clientX, y: event.clientY, ...host.measure() };
    handle.setPointerCapture(event.pointerId);
    host.active(true);
  });
  lifetime.listen(handle, 'pointermove', (event: PointerEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const width = drag.width - (event.clientX - drag.x);
    if (host.collapse?.(width)) {
      finish();
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      return;
    }
    host.resize(width, drag.height + event.clientY - drag.y);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    lifetime.listen(handle, type, finish);
  lifetime.listen(handle, 'keydown', (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') host.reset();
    else {
      const { width, height } = host.measure();
      host.resize(
        width + (event.key === 'ArrowLeft' ? 10 : event.key === 'ArrowRight' ? -10 : 0),
        height + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0),
      );
    }
    host.save();
  });
  lifetime.listen(handle, 'dblclick', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    host.reset();
    host.save();
  });
  return () => {
    lifetime.dispose();
    drag = undefined;
  };
}
