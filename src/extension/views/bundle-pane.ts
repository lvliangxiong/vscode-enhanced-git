const fs = require('node:fs'),
  path = require('node:path');
export function bundlePane(html, media, nonce) {
  return (
    html
      .replace(/<link rel="stylesheet" href="[^"]+\/([^/"?]+)">/g, (_, file) => {
        const css = fs
          .readFileSync(path.join(media, file), 'utf8')
          .replace(
            /url\(['"]icons\/([a-zA-Z0-9_-]+\.svg)['"]\)/g,
            (_, icon) =>
              `url("data:image/svg+xml;base64,${fs.readFileSync(path.join(media, 'icons', icon)).toString('base64')}")`,
          );
        return `<style nonce="${nonce}">${css}</style>`;
      })
      // Embedded panes import their application module once in the host bundle.
      // Only styles, static bootstrap data and the React mount point cross this boundary.
      .replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/g, '')
  );
}
