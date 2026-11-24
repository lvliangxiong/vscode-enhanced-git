import * as monaco from 'monaco-editor/editor/editor.api.js';
// Webviews support blob workers; package and fetch the worker locally. There is
// no CDN, eval, or dependency on the user's installed VS Code runtime files.
let workerSource: Promise<string>;
export function configureWorker() {
  const source = document.querySelector<HTMLMetaElement>('meta[name="merge-worker"]')?.content;
  if (!source) throw new Error('Missing packaged editor worker');
  const environment: monaco.Environment = {
    getWorker: async () => {
      workerSource ??= fetch(source).then(async (response) => {
        if (!response.ok) throw new Error('Cannot load the packaged editor worker');
        const url = URL.createObjectURL(
          new Blob([await response.text()], { type: 'text/javascript' }),
        );
        window.addEventListener('unload', () => URL.revokeObjectURL(url), { once: true });
        return url;
      });
      return new Worker(await workerSource, { name: 'vscode-enhanced-git-merge-editor' });
    },
  };
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = environment;
}

export function languageFor(path: string) {
  const name = (path.split('/').at(-1) ?? '').toLowerCase();
  return (
    monaco.languages
      .getLanguages()
      .find(
        (language) =>
          language.filenames?.some((file) => file.toLowerCase() === name) ||
          language.extensions?.some((extension) => name.endsWith(extension.toLowerCase())),
      )?.id || 'plaintext'
  );
}
