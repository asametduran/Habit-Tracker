// Checks the sync logic (src/lib/sync) against an in-memory fake server: no app, no network.
// Run with: node scripts/check-sync.mjs
// The modules are TypeScript; Node strips the types itself, and the hook below resolves the
// `@/` import alias. They must be imported after the hook is registered, hence `await import`.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    const file = path.join(src, `${specifier.slice(2)}.ts`);
    return nextResolve(pathToFileURL(file).href, context);
  },
});

const { DEFAULT_SETTINGS, applyCount, cleanName, migrateHabit } = await import('@/lib/habit-logic');
const { createHabitStore } = await import('@/lib/sync/habit-store');
const { createFakeServer } = await import('@/lib/sync/remote-store-fake');
const { createSyncEngine } = await import('@/lib/sync/sync-engine');
const { stableJson } = await import('@/lib/sync/rows');
const {
  adoptReplica,
  applyState,
  deserializeReplica,
  diffReplica,
  emptyReplica,
  pendingCount,
  replicaToState,
  serializeReplica,
} = await import('@/lib/sync/replica');

const D1 = '2026-11-16';
const D2 = '2026-11-17';
const USER = 'user-1';

// One clock for every device and the server; each reading is a second later than the last.
let time = Date.parse('2026-11-16T08:00:00.000Z');
const tick = () => new Date((time += 1000)).toISOString();

/** A phone: its own store and sync engine, on its own idea of what day it is. */
function device(server, userId = USER) {
  const dev = { day: D1 };
  const clock = { today: () => dev.day, now: tick };
  dev.store = createHabitStore(clock);
  dev.signIn = (id) => {
    const { replica } = dev.store.getSnapshot();
    dev.store.reset(replica.owner === null ? adoptReplica(replica, id) : emptyReplica(id));
    dev.engine = createSyncEngine({
      store: dev.store,
      remote: server.remoteFor(id),
      clock,
      schedule: () => 0,
      cancel: () => {},
    });
  };
  dev.sync = () => dev.engine.syncNow();
  dev.state = () => dev.store.getSnapshot().state;
  dev.replica = () => dev.store.getSnapshot().replica;
  dev.habit = (id) => dev.state().habits.find((habit) => habit.id === id);
  dev.pending = () => pendingCount(dev.replica());
  // The same changes the app's `useHabits()` mutators make.
  dev.onboard = () => dev.store.update((s) => ({ ...s, onboardingComplete: true }));
  dev.addHabit = (id, extra = {}) =>
    dev.store.update((s) => ({
      ...s,
      habits: [
        ...s.habits,
        { id, name: id, type: 'daily', count: 0, streak: 0, bestStreak: 0, createdAt: dev.day, ...extra },
      ],
    }));
  dev.setCount = (id, count) =>
    dev.store.update((s) => ({
      ...s,
      habits: s.habits.map((habit) => (habit.id === id ? applyCount(habit, count) : habit)),
    }));
  dev.removeHabit = (id) =>
    dev.store.update((s) => ({ ...s, habits: s.habits.filter((habit) => habit.id !== id) }));
  dev.startChallenge = (habitIds, durationDays = 3) =>
    dev.store.update((s) => ({
      ...s,
      challenge: { habitIds, durationDays, startDate: dev.day, daysCompleted: 0, status: 'active' },
    }));
  dev.newDay = (day) => {
    dev.day = day;
    dev.store.rollToday();
  };
  if (userId) dev.signIn(userId);
  return dev;
}

async function ok(dev) {
  const outcome = await dev.sync();
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error);
  return outcome;
}

/** Two signed-in devices that both hold habit `h1`, fully synced. */
async function pair(extra) {
  const server = createFakeServer(tick);
  const a = device(server);
  const b = device(server);
  a.onboard();
  a.addHabit('h1', extra);
  await ok(a);
  await ok(b);
  assert.equal(b.habit('h1').name, 'h1');
  assert.equal(b.state().onboardingComplete, true);
  return { server, a, b };
}

test('state survives the trip through the replica and through storage', () => {
  const state = {
    habits: [
      { id: 'a', name: 'Read', type: 'daily', count: 1, streak: 4, bestStreak: 9, createdAt: '2026-11-01' },
      {
        id: 'b',
        name: 'Water',
        type: 'quantity',
        target: 8,
        count: 3,
        streak: 0,
        bestStreak: 2,
        createdAt: '2026-11-02',
        reminder: { enabled: true, hour: 9, minute: 30, days: [2, 3, 4] },
      },
    ],
    history: [
      { date: '2026-11-14', habitId: 'a', count: 1, completed: true },
      { date: '2026-11-15', habitId: 'a', count: 1, completed: true },
      { date: '2026-11-15', habitId: 'b', count: 5, completed: false },
    ],
    challenge: {
      name: 'Week one',
      habitIds: ['a', 'b'],
      durationDays: 7,
      startDate: '2026-11-14',
      daysCompleted: 1,
      status: 'active',
      celebrated: false,
    },
    lastRolloverDate: D1,
    onboardingComplete: true,
    settings: { ...DEFAULT_SETTINGS, afternoonNudge: false },
  };
  const replica = applyState(emptyReplica(), null, state, tick());
  assert.equal(stableJson(replicaToState(replica, D1)), stableJson(state));

  const restored = deserializeReplica(serializeReplica(replica));
  assert.equal(stableJson(replicaToState(restored, D1)), stableJson(state));
  assert.equal(pendingCount(restored), pendingCount(replica));
  assert.equal(deserializeReplica({}), null);

  // Saving after one tap writes that one row, not everything.
  const tapped = { ...state, habits: state.habits.map((h) => (h.id === 'b' ? applyCount(h, 4) : h)) };
  const next = applyState(replica, state, tapped, tick());
  const delta = diffReplica(replica, next);
  assert.deepEqual(Object.keys(delta.put), ['h:b']);
  assert.deepEqual(delta.del, []);
  assert.equal(Object.keys(diffReplica(null, next).put).length, 2 + 3 + 3);
});

test('a second device gets everything, and a quiet sync changes nothing', async () => {
  const { a, b } = await pair();
  assert.equal(a.pending(), 0);
  assert.equal(b.pending(), 0);
  const before = b.replica();
  const outcome = await ok(b);
  assert.equal(outcome.pushed, 0);
  assert.equal(b.replica().habits, before.habits);
  assert.equal(b.replica().userState, before.userState);
});

test('stale rollover keeps the streak', async () => {
  const { server, a, b } = await pair();
  a.setCount('h1', 1);
  await ok(a);
  // B never sees the check-off, and closes the day on its own while offline.
  b.newDay(D2);
  assert.equal(b.habit('h1').streak, 0);
  await ok(b);
  assert.equal(b.habit('h1').streak, 1);
  assert.equal(b.habit('h1').count, 0);
  assert.deepEqual(b.state().history, [{ date: D1, habitId: 'h1', count: 1, completed: true }]);

  a.day = D2;
  await ok(a);
  a.store.rollToday();
  assert.equal(a.habit('h1').streak, 1);
  assert.equal(a.state().lastRolloverDate, D2);
  assert.deepEqual(a.state().history, b.state().history);
  assert.equal(server.account(USER).history.get(`h1|${D1}`).completed, true);
  assert.equal(a.pending(), 0);
});

test('concurrent counts take the higher one', async () => {
  const { server, a, b } = await pair({ type: 'quantity', target: 5 });
  a.setCount('h1', 2);
  b.setCount('h1', 5);
  await ok(b);
  await ok(a);
  await ok(b);
  for (const dev of [a, b]) {
    assert.equal(dev.habit('h1').count, 5);
    assert.equal(dev.habit('h1').streak, 1);
    assert.equal(dev.pending(), 0);
  }
  assert.equal(server.account(USER).habits.get('h1').count, 5);
});

test('a rename on one device and a check-off on another both survive', async () => {
  const { a, b } = await pair();
  a.store.update((s) => ({ ...s, habits: s.habits.map((h) => ({ ...h, name: 'Renamed' })) }));
  b.setCount('h1', 1);
  await ok(a);
  await ok(b);
  await ok(a);
  for (const dev of [a, b]) {
    assert.equal(dev.habit('h1').name, 'Renamed');
    assert.equal(dev.habit('h1').count, 1);
  }
});

test('removing a habit reaches the other device', async () => {
  const { server, a, b } = await pair();
  a.addHabit('h2');
  await ok(a);
  await ok(b);
  a.removeHabit('h1');
  assert.equal(a.pending(), 1);
  await ok(a);
  assert.equal('h1' in a.replica().habits, false); // nothing left to remember once confirmed
  await ok(b);
  assert.deepEqual(b.state().habits.map((habit) => habit.id), ['h2']);
  assert.notEqual(server.account(USER).habits.get('h1').deleted_at, null);
  assert.equal(b.pending(), 0);
});

test('edit during push stays dirty', async () => {
  const { server, a } = await pair({ type: 'quantity', target: 5 });
  a.setCount('h1', 1);
  server.hooks.beforePush = () => a.setCount('h1', 3);
  await ok(a);
  assert.equal(a.habit('h1').count, 3);
  assert.equal(server.account(USER).habits.get('h1').count, 1);
  assert.equal(a.pending(), 1);
  await ok(a);
  assert.equal(server.account(USER).habits.get('h1').count, 3);
  assert.equal(a.pending(), 0);
});

test('failed push is retried', async () => {
  const { server, a, b } = await pair();
  a.setCount('h1', 1);
  server.failNext('push');
  const failed = await a.sync();
  assert.equal(failed.ok, false);
  assert.equal(a.habit('h1').count, 1);
  assert.equal(a.pending(), 1);
  server.failNext('pull');
  assert.equal((await a.sync()).ok, false);
  assert.equal(a.habit('h1').count, 1);
  await ok(a);
  assert.equal(a.pending(), 0);
  await ok(b);
  assert.equal(b.habit('h1').count, 1);
});

test('reset wipes the other device', async () => {
  const { server, a, b } = await pair();
  b.setCount('h1', 1);
  b.addHabit('h2');
  const epoch = await server.remoteFor(USER).reset();
  a.store.reset({ ...emptyReplica(USER), epoch });
  await ok(b);
  assert.deepEqual(b.state().habits, []);
  assert.deepEqual(b.state().history, []);
  assert.equal(b.state().onboardingComplete, false);
  assert.equal(b.pending(), 0);
  assert.equal(server.account(USER).habits.size, 0);
  await ok(a);
  assert.deepEqual(a.state().habits, []);
  assert.equal(server.account(USER).habits.size, 0);
});

test('first sign-in merges', async () => {
  const server = createFakeServer(tick);
  const a = device(server);
  a.onboard();
  a.addHabit('a1');
  a.startChallenge(['a1'], 5);
  a.store.update((s) => ({ ...s, settings: { ...s.settings, afternoonNudge: false } }));
  await ok(a);

  // C was used without an account, then signs in to the one above.
  const c = device(server, null);
  c.onboard();
  c.addHabit('c1');
  c.setCount('c1', 1);
  c.startChallenge(['c1'], 9);
  c.store.update((s) => ({ ...s, settings: { ...s.settings, streakAlert: false } }));
  c.signIn(USER);
  assert.equal(c.habit('c1').count, 1);
  await ok(c);
  assert.deepEqual(c.state().habits.map((habit) => habit.id), ['a1', 'c1']);
  assert.equal(c.habit('c1').count, 1);
  assert.deepEqual(c.state().challenge.habitIds, ['a1']);
  assert.deepEqual(c.state().settings, { ...DEFAULT_SETTINGS, afternoonNudge: false });
  assert.equal(c.pending(), 0);
  await ok(a);
  assert.deepEqual(a.state().habits.map((habit) => habit.id), ['a1', 'c1']);
  assert.equal(a.state().challenge.durationDays, 5);

  // Another person's account sees none of it.
  const other = device(server, 'user-2');
  await ok(other);
  assert.deepEqual(other.state().habits, []);
});

test('a challenge failed by a stale device is repaired', async () => {
  const { a, b } = await pair();
  a.startChallenge(['h1'], 3);
  await ok(a);
  await ok(b);
  a.setCount('h1', 1);
  await ok(a);
  b.newDay(D2);
  assert.equal(b.state().challenge.status, 'failed');
  await ok(b);
  assert.equal(b.state().challenge.status, 'active');
  assert.equal(b.state().challenge.daysCompleted, 1);
  a.day = D2;
  await ok(a);
  a.store.rollToday();
  assert.equal(a.state().challenge.status, 'active');
  assert.equal(a.state().challenge.daysCompleted, 1);
});

test('two devices closing the same day count it once', async () => {
  const { a, b } = await pair();
  a.startChallenge(['h1'], 3);
  a.setCount('h1', 1);
  await ok(a);
  await ok(b);
  a.newDay(D2);
  b.newDay(D2);
  await ok(a);
  await ok(b);
  await ok(a);
  for (const dev of [a, b]) {
    assert.equal(dev.state().challenge.daysCompleted, 1);
    assert.equal(dev.habit('h1').streak, 1);
    assert.equal(dev.state().history.length, 1);
    assert.equal(dev.pending(), 0);
  }
});

test('a real missed day still fails the challenge and breaks the streak', async () => {
  const { a, b } = await pair();
  a.startChallenge(['h1'], 3);
  await ok(a);
  a.newDay(D2);
  await ok(a);
  b.day = D2;
  await ok(b);
  b.store.rollToday();
  for (const dev of [a, b]) {
    assert.equal(dev.state().challenge.status, 'failed');
    assert.equal(dev.habit('h1').streak, 0);
  }
});

test('names are trimmed and cut to 100 characters, never mid-emoji', () => {
  assert.equal(cleanName('  Read  '), 'Read');
  assert.equal(cleanName('x'.repeat(150)), 'x'.repeat(100));
  assert.equal(cleanName('🔥'.repeat(150)), '🔥'.repeat(100));
  const stored = { id: 'a', name: 'y'.repeat(300), type: 'daily', count: 0, streak: 0, bestStreak: 0, createdAt: D1 };
  assert.equal(migrateHabit(stored).name, 'y'.repeat(100));
});

test('an over-long name from an older app is shortened, and goes back to the server shortened', async () => {
  // The server now rejects names over 200 characters; an older app version wrote any length.
  const server = createFakeServer(tick);
  const a = device(server);
  a.onboard();
  a.addHabit('h1', { name: `  ${'x'.repeat(300)}  ` });
  a.store.update((s) => ({
    ...s,
    challenge: { name: 'c'.repeat(300), habitIds: ['h1'], durationDays: 3, startDate: a.day, daysCompleted: 0, status: 'active' },
  }));
  await ok(a);

  const b = device(server);
  await ok(b);
  assert.equal(b.habit('h1').name, 'x'.repeat(100));
  assert.equal(b.state().challenge.name, 'c'.repeat(100));

  b.setCount('h1', 1);
  await ok(b);
  assert.equal(server.account(USER).habits.get('h1').name, 'x'.repeat(100));
});
