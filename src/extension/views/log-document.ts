export function logDocument(vscode, context, view, options, root) {
  const nonce = options.nonce;
  const css = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.css'),
  );
  const iconsCss = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'icons.css'),
  );
  const compactCss = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'compact.css'),
  );
  const filtersCss = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'filters.css'),
  );
  const js = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'),
  );
  const branchCss = view.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'branch-compare.css'),
  );
  const bootstrap =
    options.comparison || options.embedded
      ? `<script id="frame-config" type="application/json" nonce="${nonce}">${JSON.stringify(options.comparison || { repositoryFrame: true }).replace(/</g, '\\u003c')}</script>`
      : '';
  return [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; font-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`,
    `<link rel="stylesheet" href="${css}">`,
    `<link rel="stylesheet" href="${iconsCss}">`,
    `<link rel="stylesheet" href="${compactCss}">`,
    `<link rel="stylesheet" href="${filtersCss}">`,
    `<link rel="stylesheet" href="${branchCss}">`,
    `<link rel="stylesheet" href="${view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'branch-summary.css'))}">`,
    `<style nonce="${nonce}" id="layout-style">`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<div id="app"></div>`,
    `<script id="saved-layout" type="application/json" nonce="${nonce}">${JSON.stringify(context.workspaceState.get(`vsgit.layout:${root}`, {})).replace(/</g, '\\u003c')}</script>${bootstrap}`,
    `<script nonce="${nonce}" src="${js}"></script>`,
    `</body>`,
    `</html>`,
  ].join('');
}
