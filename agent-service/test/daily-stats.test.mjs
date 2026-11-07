import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyChanges} from '../../site/daily-stats.mjs';

const history = {timeZone:'America/Los_Angeles', snapshots:[
  {date:'2026-11-05', videos:1, impressions:100, plays:10},
  {date:'2026-11-06', videos:2, impressions:170, plays:10}
]};
const videos = [{impressions:100, views:10}, {impressions:70, views:null}];

test('daily totals include new references without inventing missing video plays', () => {
  const result = dailyChanges(videos, history, new Date('2026-11-06T23:00:00Z'));
  assert.deepEqual(result.changes, {videos:1, impressions:70, plays:0});
  assert.equal(result.baselineDate,'2026-11-05');
});
test('calendar day follows Pacific time rather than the UTC date', () => {
  assert.equal(dailyChanges(videos, history, new Date('2026-11-07T07:59:59Z')).baselineDate,'2026-11-05');
  assert.deepEqual(dailyChanges(videos, history, new Date('2026-11-07T08:00:00Z')).changes,{videos:0, impressions:0, plays:0});
});
test('days without publications carry forward the most recent published totals', () => {
  assert.deepEqual(dailyChanges(videos, history, new Date('2026-11-10T18:00:00Z')).changes,{videos:0, impressions:0, plays:0});
});
test('no baseline stays unavailable, while removals retain negative changes', () => {
  assert.equal(dailyChanges(videos, {snapshots:[]}),null);
  assert.deepEqual(dailyChanges([], history, new Date('2026-11-07T18:00:00Z')).changes,{videos:-2, impressions:-170, plays:-10});
});
