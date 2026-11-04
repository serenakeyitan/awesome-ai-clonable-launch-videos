const ROOT = 'https://raw.githubusercontent.com/serenakeyitan/awesome-ai-clonable-launch-videos/main/';
export const SOURCES = {catalog: `${ROOT}data/videos.json`, manifest: `${ROOT}agent/manifest.json`, workflow: `${ROOT}agent/workflow.md`};

export async function readBounded(response, limit) {
  if (!response.ok) throw new Error('Published source unavailable');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Published source exceeds size limit');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Published source exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

// The request-specific cache key bypasses upstream/CDN caches. No local snapshot fallback.
export async function loadArchive(fetcher = fetch) {
  const nonce = crypto.randomUUID();
  const texts = await Promise.all(Object.entries(SOURCES).map(async ([key, url]) => {
    const response = await fetcher(`${url}?fresh=${nonce}`, {
      headers: {'User-Agent':'LaunchArchiveAgent/1.0', 'Cache-Control':'no-cache'},
      cache: 'no-store', signal: AbortSignal.timeout(12000)
    });
    return [key, await readBounded(response, key === 'catalog' ? 4 * 1024 * 1024 : 65536)];
  }));
  const raw = Object.fromEntries(texts);
  const videos = JSON.parse(raw.catalog);
  const manifest = JSON.parse(raw.manifest);
  if (manifest.schemaVersion !== 1 || !Array.isArray(videos) || !videos.length || videos.length > 5000) throw new Error('Published archive schema unavailable');
  if (videos.some(v => !Number.isInteger(v.id) || !v.title || !v.source || !Array.isArray(v.styles))) throw new Error('Published catalog is invalid');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(raw)));
  const version = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const facets = key => [...new Set(videos.flatMap(v => v[key] ?? []))].sort();
  return {videos, manifest, workflow:raw.workflow, version, fetchedAt:new Date().toISOString(), facets:{categories:facets('category'), styles:facets('styles'), ratios:facets('ratio'), formats:manifest.formats ?? []}};
}

export function context(archive) {
  return {version:archive.version, fetchedAt:archive.fetchedAt, totalVideos:archive.videos.length, facets:archive.facets, manifest:archive.manifest, workflow:archive.workflow,
    metricsNote:'Statistics are dated snapshots, not live counts. Impressions are post exposure; views are video plays. Missing counts remain null.'};
}

export function record(v, detail = false) {
  const result = {id:v.id, slug:v.slug, title:v.title, account:v.account, category:v.category, format:v.readmeCategory, styles:v.styles, ratio:v.ratio,
    clipSeconds:v.clipSeconds, originalSeconds:v.originalSeconds, excerpt:v.excerpt, hasAudio:v.hasAudio,
    date:v.date, snapshotDate:v.snapshotDate, impressions:v.impressions, views:v.views,
    source:v.source, watchUrl:v.watchUrl, githubVideoUrl:v.githubVideoUrl,
    poster:new URL(v.poster, 'https://raw.githubusercontent.com/serenakeyitan/awesome-ai-clonable-launch-videos/main/').href,
    detailUrl:v.detailUrl, remakePrompt:`clone this video 1:1 for my product ${v.source}`};
  if (detail) Object.assign(result, {width:v.width, height:v.height, notes:v.notes, likes:v.likes, bookmarks:v.bookmarks, reposts:v.reposts, replies:v.replies, quotes:v.quotes, followers:v.followers});
  return result;
}

export function search(archive, args = {}) {
  const tokens = (args.query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = archive.videos.map(v => {
    const title = `${v.title} ${v.account}`.toLowerCase();
    const text = `${title} ${v.category} ${v.styles.join(' ')} ${(v.notes ?? []).join(' ')}`.toLowerCase();
    return {v, score:tokens.reduce((n,t) => n + (title.includes(t) ? 3 : text.includes(t) ? 1 : 0), 0)};
  }).filter(({v,score}) => (!tokens.length || score > 0) && (!args.style || v.styles.some(s => s.toLowerCase() === args.style.toLowerCase())) && (!args.category || v.category.toLowerCase() === args.category.toLowerCase()) && (!args.ratio || v.ratio === args.ratio));
  rows.sort((a,b) => args.sort === 'newest' ? b.v.date.localeCompare(a.v.date) : args.sort === 'impressions' ? (b.v.impressions ?? -1) - (a.v.impressions ?? -1) : b.score - a.score || (b.v.impressions ?? -1) - (a.v.impressions ?? -1));
  return {totalMatches:rows.length, videos:rows.slice(0, args.limit ?? 6).map(({v}) => record(v))};
}

export function findVideo(archive, reference) {
  const ref = reference.trim().replace(/\?.*$/, '').replace(/\/video\/\d+\/?$/, '').replace(/\/$/, '');
  return archive.videos.find(v => String(v.id) === ref || v.slug === ref || v.source === ref || (ref.match(/status\/(\d+)/)?.[1] && ref.match(/status\/(\d+)/)[1] === v.source.match(/status\/(\d+)/)?.[1]));
}
