import type { LogContext } from './context';
/** Repaint cached Canvas geometry; never re-fetch or rebuild rows on theme changes. */
export function installGraphTheme(ctx: LogContext) {
  const { document, window } = ctx.env;
  let frame = 0;
  const update = () => {
    if (!frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        ctx.actions.graph.repaintGraphCanvases();
      });
  };
  const bodyObserver = new MutationObserver(update);
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  const rootObserver = new MutationObserver(update);
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  ctx.lifetime.listen(window, 'resize', update);
  ctx.lifetime.listen(window, 'vsCodeGitTheme', update);
  ctx.lifetime.add(() => {
    bodyObserver.disconnect();
    rootObserver.disconnect();
    window.cancelAnimationFrame(frame);
  });
}
