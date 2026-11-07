export function dailyChanges(videos, history, now = new Date()) {
  const zone = history?.timeZone ?? 'America/Los_Angeles';
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0,10);
  // Carry unchanged published totals forward across days with no catalog edits.
  const baseline = (history?.snapshots ?? []).filter(s => s.date <= yesterday).sort((a,b) => b.date.localeCompare(a.date))[0];
  if (!baseline) return null;
  const totals = {videos:videos.length, impressions:videos.reduce((n,v) => n + (v.impressions ?? 0),0), plays:videos.reduce((n,v) => n + (v.views ?? 0),0)};
  if (Object.keys(totals).some(key => !Number.isFinite(baseline[key]))) return null;
  return {baselineDate:baseline.date, yesterday, changes:Object.fromEntries(Object.entries(totals).map(([key,value]) => [key, value - baseline[key]]))};
}
