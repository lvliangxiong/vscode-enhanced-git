import type * as VSCode from 'vscode';

type Surface = { webview: VSCode.Webview };

export function repositoryHostDocument(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  view: Surface,
  nonce: string,
) {
  const resource = (file: string) =>
    view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', file));
  return [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; font-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`,
    `<link rel="stylesheet" href="${resource('repository-host.css')}">`,
    `<link rel="stylesheet" href="${resource('branch-summary.css')}">`,
    `<style nonce="${nonce}" id="layout-style">`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<div id="host-app"></div>`,
    `<script nonce="${nonce}" src="${resource('repository-host.js')}">`,
    `</script>`,
    `</body>`,
    `</html>`,
  ].join('');
}

export function comparisonHostDocument(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  view: Surface,
  nonce: string,
  documents: string[],
) {
  const resource = (file: string) =>
    view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', file));
  return [
    `<!DOCTYPE html>`,
    `<html>`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} data:; font-src ${view.webview.cspSource} data:; style-src ${view.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`,
    `<link rel="stylesheet" href="${resource('compare-host.css')}">`,
    `<style nonce="${nonce}" id="host-style">`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<div id="host-app"></div>`,
    `<script id="compare-documents" type="application/json" nonce="${nonce}">${JSON.stringify(documents).replace(/</g, '\\u003c')}</script>`,
    `<script nonce="${nonce}" src="${resource('compare-host.js')}">`,
    `</script>`,
    `</body>`,
    `</html>`,
  ].join('');
}
