import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildHistoryIndex, readHistoryIndexRaw } from './history-index';
import { historyIdentity, historyState } from './history-identity';
import { updateHistoryIndexRaw } from './history-index-update';

type Index = Awaited<ReturnType<typeof buildHistoryIndex>>;
const schema = 3;
const maxBytes = 32 * 1024 * 1024;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

// Shared by Log views in one extension host. Only immutable commit data is
// shared; selection, filters and Recent remain owned by each repository/view.
export function createHistoryIndexStore(
  storagePath?: string,
  report: (message: string) => void = () => {},
) {
  const directory = storagePath && path.join(storagePath, 'history-index');
  type Entry = { identity: string; value: Promise<Index>; raw?: string; compatibility?: string };
  const entries = new Map<string, Entry>();
  // Serialize writes/retention so an older writer cannot replace a newer snapshot.
  let writes = Promise.resolve();

  async function read(file: string) {
    try {
      if ((await fs.stat(file)).size > maxBytes + 1024) return;
      const contents = await fs.readFile(file, 'utf8');
      const newline = contents.indexOf('\n');
      if (newline < 0 || newline > 1024) return;
      const header = JSON.parse(contents.slice(0, newline));
      const raw = contents.slice(newline + 1);
      if (header.schema === schema && header.checksum === digest(raw))
        return {
          raw,
          identity: header.identity as string,
          compatibility: header.compatibility as string,
        };
    } catch {
      // Missing, corrupt or inaccessible caches are disposable.
    }
  }

  async function write(file: string, identity: string, compatibility: string, raw: string) {
    const directory = path.dirname(file);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        temporary,
        JSON.stringify({ schema, identity, compatibility, checksum: digest(raw) }) + '\n' + raw,
        { mode: 0o600 },
      );
      await fs.rename(temporary, file);
      const files = await Promise.all(
        (await fs.readdir(directory))
          .filter((name) => /^[a-f0-9]{64}\.index$/.test(name))
          .map(async (name) => ({
            name,
            time: (await fs.stat(path.join(directory, name))).mtimeMs,
          })),
      );
      files.sort((a, b) => b.time - a.time);
      await Promise.all(files.slice(3).map(({ name }) => fs.unlink(path.join(directory, name))));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  return {
    load(root: string, identity: string, force = false): Promise<Index> {
      const cached = entries.get(root);
      if (!force && cached?.identity === identity) {
        entries.delete(root);
        entries.set(root, cached);
        return cached.value;
      }
      const value: Promise<Index> = Promise.resolve().then(async () => {
        const started = performance.now();
        let mode = 'full';
        let added: number | undefined;
        let topologyReport = '';
        const file = directory && path.join(directory, digest(root) + '.index');
        const state = await historyState(root);
        if (state.identity !== identity) return undefined;
        // Await a previous build rather than racing two full readers for one root.
        if (cached) await cached.value.catch(() => {});
        const saved = force
          ? undefined
          : cached?.raw !== undefined
            ? { raw: cached.raw, identity: cached.identity, compatibility: cached.compatibility }
            : file
              ? await read(file)
              : undefined;
        let raw: string;
        if (saved?.identity === identity) {
          raw = saved.raw;
          mode = 'disk';
        } else if (saved?.compatibility === state.compatibility) {
          const updated = await updateHistoryIndexRaw(root, saved.raw, true);
          if (!updated) return undefined;
          raw = updated.raw;
          added = updated.added;
          mode = 'incremental';
          topologyReport = `, topology ${updated.topologyMode}: ${updated.topologyRead} rows read`;
        } else raw = await readHistoryIndexRaw(root);
        const prior =
          !force && cached?.compatibility === state.compatibility ? await cached.value : undefined;
        const index = await buildHistoryIndex(root, raw, prior?.seed);
        // Git may change while the background reader runs. Never publish or
        // persist data under an identity that no longer describes it.
        if (!index || (await historyIdentity(root)) !== identity) return undefined;
        entry.raw = raw;
        entry.compatibility = state.compatibility;
        if (file && saved?.identity !== identity) {
          writes = writes
            .catch(() => {})
            .then(async () => {
              if (entries.get(root) === entry)
                await write(file, identity, state.compatibility, raw);
            });
          await writes.catch(() => {}); // Disk failure must not disable a valid memory index.
        }
        report(
          `Search index ready: ${mode}, ${index.count} commits, ${added ?? (mode === 'disk' ? 0 : index.count)} details read${topologyReport}, ${Math.round(performance.now() - started)} ms`,
        );
        return index;
      });
      const entry: Entry = { identity, value };
      entries.set(root, entry);
      while (entries.size > 3) entries.delete(entries.keys().next().value);
      void entry.value.catch(() => {
        if (entries.get(root) === entry) entries.delete(root);
      });
      return entry.value;
    },
  };
}
