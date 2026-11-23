// Checks the numbers the AI coach is given (supabase/functions/_shared/stats.ts): the model only
// words them, so a wrong percentage here is a wrong percentage in every nudge and report.
// Run with: node scripts/check-coach.mjs
// The module is TypeScript with no imports; Node strips the types itself.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase/functions/_shared/stats.ts',
);
const { addDays, catchUp, isDateKey, nudgeSnapshot, reportSnapshot, weekday, windowStats } =
  await import(pathToFileURL(file).href);
const { dutiesFor, isActive, localClock } = await import(
  pathToFileURL(path.join(path.dirname(file), 'schedule.ts')).href
);

const TODAY = '2026-11-19'; // a Thursday

function habit(fields) {
  return {
    id: 'h1',
    name: 'Read',
    type: 'daily',
    target: null,
    count: 0,
    streak: 0,
    best_streak: 0,
    count_date: TODAY,
    created_at_day: '2026-10-01',
    deleted_at: null,
    ...fields,
  };
}

/** A completed (or not) log entry for each of `days` before today. */
function logs(habitId, days, completed = () => true, count = 1) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(TODAY, -(i + 1));
    const done = completed(date, i);
    return { habit_id: habitId, date, count: done ? count : 0, completed: done };
  });
}

test('date helpers handle month ends, weekdays and impossible dates', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday(TODAY), 'Thursday');
  assert.equal(isDateKey('2026-11-19'), true);
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2026-11-19T00:00'), false);
  assert.equal(isDateKey(20261119), false);
});

test('a window only counts days since the habit was created, and unlogged days are misses', () => {
  const h = habit({ created_at_day: addDays(TODAY, -4) }); // existed for the last 4 finished days
  const history = [
    { habit_id: 'h1', date: addDays(TODAY, -4), count: 1, completed: true },
    { habit_id: 'h1', date: addDays(TODAY, -3), count: 1, completed: true },
    // -2 was never logged (app not opened): a miss
    { habit_id: 'h1', date: addDays(TODAY, -1), count: 1, completed: true },
    { habit_id: 'other', date: addDays(TODAY, -2), count: 1, completed: true },
  ];
  const stats = windowStats(h, history, addDays(TODAY, -7), addDays(TODAY, -1));
  assert.equal(stats.tracked, 4);
  assert.equal(stats.done, 3);
  assert.equal(stats.rate, 75);
});

test('a habit created after the window has nothing to measure', () => {
  const stats = windowStats(habit({ created_at_day: TODAY }), [], addDays(TODAY, -7), addDays(TODAY, -1));
  assert.deepEqual([stats.tracked, stats.done, stats.rate], [0, 0, null]);
});

test('halves show a mid-period drop-off', () => {
  const history = logs('h1', 14, (_, i) => i >= 7); // done in the older week, missed in the recent one
  const stats = windowStats(habit({}), history, addDays(TODAY, -14), addDays(TODAY, -1));
  assert.equal(stats.rate, 50);
  assert.equal(stats.first_half_rate, 100);
  assert.equal(stats.second_half_rate, 0);
});

test('the most-missed weekday needs more than one miss', () => {
  const once = windowStats(
    habit({}),
    logs('h1', 7, (date) => weekday(date) !== 'Monday'),
    addDays(TODAY, -7),
    addDays(TODAY, -1),
  );
  assert.equal(once.most_missed_weekday, null);
  const twice = windowStats(
    habit({}),
    logs('h1', 14, (date) => weekday(date) !== 'Monday'),
    addDays(TODAY, -14),
    addDays(TODAY, -1),
  );
  assert.equal(twice.most_missed_weekday, 'Monday');
});

test('quantity habits report their average against the target', () => {
  const water = habit({ id: 'w', name: 'Water', type: 'quantity', target: 8 });
  const history = logs('w', 4, (_, i) => i < 2, 8).map((e) => (e.completed ? e : { ...e, count: 4 }));
  const stats = windowStats(water, history, addDays(TODAY, -4), addDays(TODAY, -1));
  assert.equal(stats.average_count, 6); // (8 + 8 + 4 + 4) / 4
  assert.equal(stats.rate, 50);
});

test('a nudge uses today’s count only when the row is for today, and skips removed habits', () => {
  const { snapshot, summary, hasData } = nudgeSnapshot({
    habits: [
      habit({ id: 'a', name: 'Read', count: 1 }),
      habit({ id: 'b', name: 'Run', count: 1, count_date: addDays(TODAY, -1) }), // stale row
      habit({ id: 'c', name: 'Gone', deleted_at: '2026-11-10T00:00:00Z' }),
    ],
    history: logs('a', 14),
    challenge: null,
    today: TODAY,
  });
  assert.equal(hasData, true);
  assert.deepEqual(
    snapshot.habits.map((h) => [h.name, h.done_today]),
    [
      ['Read', true],
      ['Run', false],
    ],
  );
  assert.deepEqual(summary[0], { id: 'a', name: 'Read', rate: 100, done: 14, tracked: 14 });
  assert.equal(nudgeSnapshot({ habits: [], history: [], challenge: null, today: TODAY }).hasData, false);
});

test('a weekly report covers the 7 days before today and compares with the 7 before that', () => {
  const sleep = habit({ id: 's', name: 'Sleep' });
  const gym = habit({ id: 'g', name: 'Gym' });
  const history = [
    ...logs('s', 14), // every day
    ...logs('g', 14, (_, i) => i >= 7 || i % 2 === 0), // all of last week, 4 of 7 this week
  ];
  const report = reportSnapshot({ habits: [sleep, gym], history, challenge: null, today: TODAY }, 7);
  assert.deepEqual(report.period, { start: addDays(TODAY, -7), end: addDays(TODAY, -1) });
  assert.deepEqual(report.snapshot.overall, { done: 11, tracked: 14, rate: 79 });
  assert.deepEqual(report.snapshot.previous_overall, { done: 14, tracked: 14, rate: 100 });
  assert.deepEqual(report.snapshot.perfect_days, { count: 4, out_of: 7 });
  assert.deepEqual(
    report.summary.map((h) => [h.name, h.rate]),
    [
      ['Sleep', 100],
      ['Gym', 57],
    ],
  );
});

test('a report with nothing tracked in the period says so', () => {
  const brandNew = habit({ created_at_day: TODAY });
  const report = reportSnapshot({ habits: [brandNew], history: [], challenge: null, today: TODAY }, 7);
  assert.equal(report.hasData, false);
  assert.deepEqual(report.snapshot.previous_overall, { done: 0, tracked: 0, rate: null });
});

test('a day the app hasn’t closed yet counts as logged, and only yesterday keeps a streak alive', () => {
  const yesterday = addDays(TODAY, -1);
  const input = {
    habits: [
      habit({ id: 'done', count: 1, streak: 5, count_date: yesterday }),
      habit({ id: 'missed', count: 0, streak: 4, count_date: yesterday }),
      habit({ id: 'stale', count: 1, streak: 9, count_date: addDays(TODAY, -3) }),
      habit({ id: 'today', count: 1, streak: 2, count_date: TODAY }),
    ],
    history: [],
    challenge: null,
    today: TODAY,
  };
  const out = catchUp(input);
  assert.deepEqual(
    out.habits.map((h) => [h.id, h.streak, h.count, h.count_date]),
    [
      ['done', 5, 0, TODAY],
      ['missed', 0, 0, TODAY],
      ['stale', 0, 0, TODAY],
      ['today', 2, 1, TODAY],
    ],
  );
  assert.deepEqual(
    out.history.map((e) => [e.habit_id, e.date, e.completed]),
    [
      ['done', yesterday, true],
      ['missed', yesterday, false],
      ['stale', addDays(TODAY, -3), true],
    ],
  );
  // Rolled over already: nothing changes.
  assert.equal(catchUp({ ...input, habits: [input.habits[3]] }).habits[0], input.habits[3]);
  // And the nudge stats see yesterday's check-off.
  const { summary } = nudgeSnapshot({ ...input, habits: [habit({ id: 'done', count: 1, count_date: yesterday, created_at_day: yesterday })] });
  assert.deepEqual([summary[0].done, summary[0].tracked], [1, 1]);
});

test('the local clock follows the user’s time zone, across the date line', () => {
  const now = new Date('2026-11-23T14:30:00Z'); // a Monday in UTC
  assert.deepEqual(localClock('Europe/Istanbul', now), { date: '2026-11-23', hour: 17, weekday: 1, dayOfMonth: 23 });
  assert.deepEqual(localClock('Pacific/Kiritimati', now), { date: '2026-11-24', hour: 4, weekday: 2, dayOfMonth: 24 });
  assert.deepEqual(localClock('America/Los_Angeles', now), { date: '2026-11-23', hour: 6, weekday: 1, dayOfMonth: 23 });
  assert.equal(localClock('Not/AZone', now), null);
});

test('duties: nothing before 05:00 or with the coach off, push only 15:00-17:00, reports on Mondays and the 1st', () => {
  const at = (hour, weekday = 3, dayOfMonth = 12) => ({ date: '2026-11-12', hour, weekday, dayOfMonth });
  const on = {};
  assert.deepEqual(dutiesFor(at(4), on), { nudge: false, weekly: false, monthly: false, push: false });
  assert.deepEqual(dutiesFor(at(5), on), { nudge: true, weekly: false, monthly: false, push: false });
  assert.equal(dutiesFor(at(15), on).push, true);
  assert.equal(dutiesFor(at(17), on).push, true);
  assert.equal(dutiesFor(at(18), on).push, false);
  assert.equal(dutiesFor(at(15), { afternoonNudge: false }).push, false);
  assert.equal(dutiesFor(at(15), { aiCoach: false }).nudge, false);
  assert.equal(dutiesFor(at(9, 1), on).weekly, true);
  assert.equal(dutiesFor(at(9, 3, 1), on).monthly, true);
});

test('only people who opened the app in the last week are active', () => {
  assert.equal(isActive('2026-11-12', '2026-11-19'), true);
  assert.equal(isActive('2026-11-11', '2026-11-19'), false);
  assert.equal(isActive(null, '2026-11-19'), false);
});

test('a last-opened date in the future doesn’t keep an account active', () => {
  assert.equal(isActive('2026-11-20', '2026-11-19'), true); // the device's zone can be a day ahead
  assert.equal(isActive('2026-11-21', '2026-11-19'), false);
  assert.equal(isActive('2099-01-01', '2026-11-19'), false);
});

test('habit and challenge names reach the model cut to 80 characters, never mid-emoji', () => {
  const long = 'x'.repeat(300);
  const challenge = {
    name: long,
    habit_ids: ['a'],
    duration_days: 7,
    start_date: TODAY,
    days_completed: 0,
    status: 'active',
    deleted_at: null,
  };
  const { snapshot, summary } = nudgeSnapshot({
    habits: [
      habit({ id: 'a', name: long }),
      habit({ id: 'b', name: '🔥'.repeat(100) }),
      habit({ id: 'c', name: 'y'.repeat(80) }),
    ],
    history: [],
    challenge,
    today: TODAY,
  });
  assert.deepEqual(
    snapshot.habits.map((h) => h.name),
    [`${'x'.repeat(80)}…`, `${'🔥'.repeat(80)}…`, 'y'.repeat(80)],
  );
  assert.equal(summary[0].name, `${'x'.repeat(80)}…`);
  assert.equal(snapshot.challenge.name, `${'x'.repeat(80)}…`);
  assert.deepEqual(snapshot.challenge.habits, [`${'x'.repeat(80)}…`]);

  const report = reportSnapshot({ habits: [habit({ id: 'a', name: long })], history: [], challenge: null, today: TODAY }, 7);
  assert.equal(report.snapshot.habits[0].name, `${'x'.repeat(80)}…`);
});
