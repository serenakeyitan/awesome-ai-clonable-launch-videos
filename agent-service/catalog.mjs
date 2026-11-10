const REPO = 'serenakeyitan/awesome-ai-clonable-launch-videos';
const SOURCE_PATHS = {catalog:'data/videos.json', manifest:'agent/manifest.json', workflow:'agent/workflow.md'};

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

// Raw branch URLs can stay stale despite cache-busting queries. Resolve the
// revalidated Git ref, then read all files at the same immutable commit.
export async function loadArchive(fetcher = fetch) {
  const options = () => ({
      headers: {'User-Agent':'LaunchArchiveAgent/1.0', 'Cache-Control':'no-cache'},
      cache: 'no-store', signal: AbortSignal.timeout(12000)
  });
  const refs = await readBounded(await fetcher(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`,options()),128 * 1024);
  const sourceRevision = refs.match(/([0-9a-f]{40}) refs\/heads\/main(?:\0|\n)/)?.[1];
  if (!sourceRevision) throw new Error('Published main revision unavailable');
  const texts = await Promise.all(Object.entries(SOURCE_PATHS).map(async ([key, path]) => {
    const response = await fetcher(`https://raw.githubusercontent.com/${REPO}/${sourceRevision}/${path}`, options());
    return [key, await readBounded(response, key === 'catalog' ? 4 * 1024 * 1024 : 65536)];
  }));
  const raw = Object.fromEntries(texts);
  const catalog = JSON.parse(raw.catalog);
  const videos = Array.isArray(catalog) ? catalog : catalog?.videos;
  const catalogMetadata = Array.isArray(catalog) ? null : Object.fromEntries(Object.entries(catalog ?? {}).filter(([key]) => key !== 'videos'));
  const manifest = JSON.parse(raw.manifest);
  if (manifest.schemaVersion !== 1 || !Array.isArray(videos) || !videos.length || videos.length > 5000) throw new Error('Published archive schema unavailable');
  if (videos.some(v => !Number.isInteger(v.id) || !v.title || !v.source || !Array.isArray(v.styles))) throw new Error('Published catalog is invalid');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(raw)));
  const version = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const facets = key => [...new Set(videos.flatMap(v => v[key] ?? []))].sort();
  return {videos, catalogMetadata, manifest, workflow:raw.workflow, version, sourceRevision, fetchedAt:new Date().toISOString(), facets:{categories:facets('category'), styles:facets('styles'), ratios:facets('ratio'), formats:manifest.formats ?? []}};
}

export function context(archive) {
  return {version:archive.version, sourceRevision:archive.sourceRevision, fetchedAt:archive.fetchedAt, totalVideos:archive.videos.length, facets:archive.facets, manifest:archive.manifest, catalogMetadata:archive.catalogMetadata, workflow:archive.workflow};
}

// Preserve the flat links on the authenticated HTTP manifest, while
// retaining the nested manifest/context shape for existing MCP/HTTP consumers.
export function publicManifest(archive) {
  return {...archive.manifest, ...context(archive)};
}

// Performance metrics and legacy scores stay in the public gallery data, not
// in agent reference results or their additionalMetadata.
const KNOWN_VIDEO_FIELDS = new Set('id title originalTitle account followers category seed impressions views likes bookmarks reposts replies quotes originalSeconds clipSeconds excerpt ratio date width height hasAudio source quote styles notes originalNotes flag video poster snapshotDate collectionSource referenceGroup scores benchmark slug readmeCategory watchUrl detailUrl remakePrompt githubVideoUrl'.split(' '));

export function record(v, detail = false, revision = 'main') {
  const result = {id:v.id, slug:v.slug, title:v.title, account:v.account, category:v.category, format:v.readmeCategory, styles:v.styles, ratio:v.ratio,
    clipSeconds:v.clipSeconds, originalSeconds:v.originalSeconds, excerpt:v.excerpt, hasAudio:v.hasAudio,
    date:v.date, notes:v.notes,
    source:v.source, watchUrl:v.watchUrl, githubVideoUrl:v.githubVideoUrl,
    poster:new URL(v.poster, `https://raw.githubusercontent.com/${REPO}/${revision}/`).href,
    detailUrl:v.detailUrl, remakePrompt:`Remake this video's motion and vibe for my product: ${v.source}`};
  if (detail) {
    Object.assign(result, {width:v.width, height:v.height});
    const additionalMetadata = Object.fromEntries(Object.entries(v).filter(([key]) => !KNOWN_VIDEO_FIELDS.has(key)));
    if (Object.keys(additionalMetadata).length) result.additionalMetadata = additionalMetadata;
  }
  return result;
}

export function search(archive, args = {}) {
  if (args.sort && !['relevance','newest'].includes(args.sort)) throw new Error('Unsupported reference sort');
  const tokens = (args.query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = archive.videos.map(v => {
    const title = `${v.title} ${v.account}`.toLowerCase();
    const text = `${title} ${v.category} ${v.styles.join(' ')} ${(v.notes ?? []).join(' ')}`.toLowerCase();
    return {v, score:tokens.reduce((n,t) => n + (title.includes(t) ? 3 : text.includes(t) ? 1 : 0), 0)};
  }).filter(({v,score}) => (!tokens.length || score > 0) && (!args.style || v.styles.some(s => s.toLowerCase() === args.style.toLowerCase())) && (!args.category || v.category.toLowerCase() === args.category.toLowerCase()) && (!args.ratio || v.ratio === args.ratio));
  rows.sort((a,b) => (args.sort === 'newest' ? b.v.date.localeCompare(a.v.date) : b.score - a.score) || a.v.id - b.v.id);
  return {totalMatches:rows.length, videos:rows.slice(0, args.limit ?? 6).map(({v}) => record(v,false,archive.sourceRevision))};
}

export function findVideo(archive, reference) {
  const ref = reference.trim().replace(/\?.*$/, '').replace(/\/video\/\d+\/?$/, '').replace(/\/$/, '');
  return archive.videos.find(v => String(v.id) === ref || v.slug === ref || v.source === ref || (ref.match(/status\/(\d+)/)?.[1] && ref.match(/status\/(\d+)/)[1] === v.source.match(/status\/(\d+)/)?.[1]));
}
