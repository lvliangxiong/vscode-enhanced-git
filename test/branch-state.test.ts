import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBranchState } from '../src/webview/state/branches';
import type { Branch } from '../src/shared/model';

const branch = (name: string, group: Branch['group'] = 'Local'): Branch => ({
  name,
  ref:
    (group === 'Local' ? 'refs/heads/' : group === 'Remote' ? 'refs/remotes/' : 'refs/tags/') +
    name,
  group,
});
const marked = (state: ReturnType<typeof createBranchState>) => [...state.getState().favorites];

test('branch state resolves unset favorites from current main/master refs and preserves explicit empty favorites', () => {
  const state = createBranchState();
  const branches = [branch('main'), branch('topic'), branch('origin/master', 'Remote')];
  state.applyFavorites({ favorites: null, favoriteVersion: 0 });
  assert.deepEqual(marked(state), [], 'early favorite broadcast can arrive before branches');
  state.applySnapshot({ branches, favorites: null, favoriteVersion: 0, repositoryVersion: 0 });
  assert.deepEqual(marked(state), ['refs/heads/main', 'refs/remotes/origin/master']);
  state.applyFavorites({ favorites: [], favoriteVersion: 1 });
  state.applySnapshot({ branches: [...branches, branch('master')], repositoryVersion: 1 });
  assert.deepEqual(
    marked(state),
    [],
    'explicitly clearing all favorites must not restore defaults',
  );
  state.applySnapshot({ favorites: null, favoriteVersion: 0, repositoryVersion: 2 });
  assert.deepEqual(
    marked(state),
    [],
    'an older unset snapshot must not undo saved empty favorites',
  );
});

test('optimistic branch state updates every subscriber and deduplicates a mixed mark/unmark batch', () => {
  const state = createBranchState();
  state.applySnapshot({
    branches: [branch('main'), branch('topic')],
    favorites: ['refs/heads/main'],
    favoriteVersion: 0,
  });
  const first: string[][] = [],
    second: string[][] = [];
  const stopFirst = state.subscribe((value) => first.push([...value.favorites]));
  const stopSecond = state.subscribe((value) => second.push([...value.favorites]));
  const request = state.toggle(['refs/heads/main', 'refs/heads/topic', 'refs/heads/topic']);
  assert.deepEqual(request.changes, [
    { ref: 'refs/heads/main', marked: false },
    { ref: 'refs/heads/topic', marked: true },
  ]);
  assert.deepEqual(first, [['refs/heads/topic']]);
  assert.deepEqual(second, first);
  assert.equal(request.favoriteRequest, 1);
  stopFirst();
  state.toggle(['HEAD']);
  assert.equal(first.length, 1);
  assert.deepEqual(second.at(-1), ['refs/heads/topic', 'HEAD']);
  stopSecond();
});

test('favorite broadcasts merge other pane changes while preserving local intent until its own acknowledgment', () => {
  const state = createBranchState();
  state.applySnapshot({
    branches: [branch('main'), branch('topic')],
    favorites: [],
    favoriteVersion: 0,
  });
  const mark = state.toggle(['refs/heads/topic']);
  state.applyFavorites({ favorites: ['refs/heads/main'], favoriteVersion: 1 });
  assert.deepEqual(marked(state), ['refs/heads/main', 'refs/heads/topic']);
  const unmark = state.toggle(['refs/heads/topic']);
  state.applyFavorites({
    favorites: ['refs/heads/main', 'refs/heads/topic'],
    favoriteVersion: 2,
    favoriteAck: mark.favoriteRequest,
  });
  assert.deepEqual(
    marked(state),
    ['refs/heads/main'],
    'acknowledging mark retains subsequent unmark',
  );
  state.applyFavorites({ favorites: ['refs/heads/main', 'HEAD'], favoriteVersion: 4 });
  state.applyFavorites({
    favorites: ['refs/heads/main'],
    favoriteVersion: 3,
    favoriteAck: unmark.favoriteRequest,
  });
  assert.deepEqual(
    marked(state),
    ['refs/heads/main', 'HEAD'],
    'stale ACK releases intent without overwriting newer other-pane data',
  );
});

test('failed persistence acknowledgment rolls back only its completed optimistic operation', () => {
  const state = createBranchState();
  state.applyFavorites({ favorites: ['HEAD'], favoriteVersion: 5 });
  const first = state.toggle(['refs/heads/main']);
  const second = state.toggle(['refs/heads/topic']);
  state.applyFavorites({
    favorites: ['HEAD'],
    favoriteVersion: 5,
    favoriteAck: first.favoriteRequest,
  });
  assert.deepEqual(marked(state), ['HEAD', 'refs/heads/topic']);
  state.applyFavorites({
    favorites: ['HEAD'],
    favoriteVersion: 5,
    favoriteAck: second.favoriteRequest,
  });
  assert.deepEqual(marked(state), ['HEAD']);
});

test('history revisions reject stale badges and favorites together while branch deltas retain unchanged snapshots', () => {
  const state = createBranchState();
  const branches = [{ ...branch('main'), ahead: 2, behind: 0 }];
  state.applySnapshot({
    branches,
    repositoryVersion: 6,
    branchSnapshotKey: 'six',
    favorites: ['HEAD'],
    favoriteVersion: 1,
  });
  const mark = state.toggle(['refs/heads/main']);
  assert.equal(
    state.applySnapshot({
      branches: [{ ...branch('main'), ahead: 0, behind: 120 }],
      repositoryVersion: 5,
      favorites: [],
      favoriteVersion: 2,
      favoriteAck: mark.favoriteRequest,
    }),
    false,
  );
  assert.equal(state.getState().branches[0].ahead, 2);
  assert.deepEqual(marked(state), ['HEAD', 'refs/heads/main']);
  assert.equal(state.getState().snapshotKey, 'six');
  const previous = state.getState();
  assert.equal(
    state.applySnapshot({
      branches: branches.map((item) => ({ ...item })),
      repositoryVersion: 7,
      branchSnapshotKey: 'seven',
    }),
    false,
  );
  assert.equal(
    state.getState().branches,
    previous.branches,
    'equivalent branch records keep stable component props',
  );
  assert.equal(state.getState().favorites, previous.favorites);
  assert.equal(state.getState().repositoryVersion, 7);
  assert.equal(state.getState().snapshotKey, 'seven');
  state.applySnapshot({ repositoryVersion: 8, branchSnapshotKey: 'eight' });
  assert.equal(
    state.getState().branches,
    previous.branches,
    'delta response may omit unchanged branches',
  );
  state.applySnapshot({ repositoryVersion: 9, branches: [] });
  assert.deepEqual(state.getState().branches, []);
});

test('repository reset drops pending favorites and revision guards without recycling acknowledgment IDs', () => {
  const state = createBranchState();
  state.applySnapshot({
    branches: [branch('old')],
    repositoryVersion: 100,
    branchSnapshotKey: 'old',
    favorites: ['HEAD'],
    favoriteVersion: 90,
  });
  const oldRequest = state.toggle(['refs/heads/old']);
  state.reset();
  assert.deepEqual(marked(state), []);
  assert.deepEqual(state.getState().branches, []);
  assert.equal(state.getState().repositoryVersion, -1);
  assert.equal(state.getState().snapshotKey, undefined);
  state.applySnapshot({
    branches: [branch('main')],
    repositoryVersion: 0,
    favorites: null,
    favoriteVersion: 0,
  });
  const nextRequest = state.toggle(['refs/heads/main']);
  assert.ok(nextRequest.favoriteRequest > oldRequest.favoriteRequest);
  // The transport rejects another root's response. Even an obsolete ACK number
  // cannot remove a newer root's optimistic request if it reaches this boundary.
  state.applyFavorites({ favoriteAck: oldRequest.favoriteRequest });
  assert.deepEqual(marked(state), []);
  state.applyFavorites({ favorites: ['refs/heads/main'], favoriteVersion: 0 });
  assert.deepEqual(marked(state), [], 'new pending unmark survives an old request acknowledgment');
});

test('a renewed repository handshake resets history guard while retaining displayed and pending favorites', () => {
  const state = createBranchState();
  state.applySnapshot({
    branches: [{ ...branch('main'), behind: 4 }],
    repositoryVersion: 50,
    favorites: ['HEAD'],
    favoriteVersion: 8,
    branchSnapshotKey: 'old',
  });
  const request = state.toggle(['refs/heads/main']);
  const previous = state.getState();
  state.invalidateSnapshot();
  assert.equal(state.getState().repositoryVersion, -1);
  assert.equal(state.getState().branches, previous.branches);
  assert.equal(state.getState().favorites, previous.favorites);
  assert.equal(state.getState().snapshotKey, 'old');
  assert.equal(
    state.applySnapshot({
      branches: [{ ...branch('main'), behind: 0 }],
      repositoryVersion: 0,
      favorites: ['HEAD'],
      favoriteVersion: 8,
      branchSnapshotKey: 'new',
    }),
    true,
  );
  assert.equal(state.getState().branches[0].behind, 0);
  assert.deepEqual(marked(state), ['HEAD', 'refs/heads/main']);
  state.applyFavorites({
    favorites: ['HEAD'],
    favoriteVersion: 8,
    favoriteAck: request.favoriteRequest,
  });
  assert.deepEqual(
    marked(state),
    ['HEAD'],
    'the original pending operation still awaits its own ACK',
  );
});

test('stash snapshots retain omitted data, reject stale responses and clear on repository reset', () => {
  const state = createBranchState();
  const stashes = [{ ref: 'stash@{0}', hash: 'a', subject: 'On main: work in progress' }];
  state.applySnapshot({ repositoryVersion: 2, stashes });
  assert.deepEqual(state.getState().stashes, stashes);
  state.applySnapshot({ repositoryVersion: 2 });
  assert.equal(state.getState().stashes, stashes);
  state.applySnapshot({ repositoryVersion: 1, stashes: [] });
  assert.equal(state.getState().stashes, stashes);
  state.applySnapshot({ repositoryVersion: 3, stashes: [] });
  assert.deepEqual(state.getState().stashes, []);
  state.applySnapshot({ repositoryVersion: 4, stashes });
  state.reset();
  assert.deepEqual(state.getState().stashes, []);
});
