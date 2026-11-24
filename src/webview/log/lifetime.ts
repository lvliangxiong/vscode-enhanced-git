/** Own all subscriptions and browser resources for one mounted pane. */
export class Lifetime {
  private cleanups: (() => void)[] = [];
  private ended = false;
  get disposed() {
    return this.ended;
  }
  add(cleanup: () => void) {
    if (this.ended) cleanup();
    else this.cleanups.push(cleanup);
    return cleanup;
  }
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) {
    target.addEventListener(type, listener, options);
    return this.add(() => target.removeEventListener(type, listener, options));
  }
  dispose() {
    if (this.ended) return;
    this.ended = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}
