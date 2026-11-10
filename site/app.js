'use strict';
import {dailyChanges} from './daily-stats.mjs';
const telemetry = import('./analytics.mjs').catch(() => null);
const track = (...args) => telemetry.then(api => api?.track(...args) ?? false).catch(() => false);

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = (value) => String(value).padStart(3, '0');
const full = (value) => value == null ? '—' : value.toLocaleString('en-US');
const compact = (value) => value == null ? '—' : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const timecode = (seconds) => {
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};
const launchDate = value => new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
const displayDuration = (video) => `${timecode(video.clipSeconds)}${video.excerpt ? ` excerpt / ${timecode(video.originalSeconds)} original` : ''}`;
let videos = [];
let filtered = [];
let activeId = null;
let tableView = false;
let toastTimer;
let lastTrigger;
let filterTimer;
const playedReferences = new Set();
const engagedReferences = new Set();
const dialog = $('#video-dialog');

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500);
}

function card(video) {
  const v = video;
  return `<article class="video-card">
    <div class="thumb inline-player">
      <video controls playsinline preload="none" data-reference-id="${v.id}" data-surface="grid" poster="${v.poster}" src="${v.video}" aria-label="${escapeHTML(v.title)} inline video"></video>
      <button class="inline-play play-icon" data-play="${v.id}" aria-label="Play ${escapeHTML(v.title)}">▶</button>
      ${v.excerpt ? '<span class="excerpt-label">Excerpt</span>' : ''}<span class="timecode">${timecode(v.clipSeconds)}</span>
    </div>
    <div class="card-title-row"><h3><button class="video-title" data-open="${v.id}" aria-label="View ${escapeHTML(v.title)} details">${escapeHTML(v.title)}</button></h3></div>
    <div class="byline">${escapeHTML(v.account)}</div>
    <div class="launch-date" title="Date of the original launch post (PT)">Launch date · <time datetime="${escapeHTML(v.date)}">${launchDate(v.date)}</time></div>
    <div class="card-metrics"><div><strong title="${full(v.impressions)} impressions">${compact(v.impressions)} ${v.flag ? '<span class="flag-mark" title="Video plays are below 3% of impressions">△</span>' : ''}</strong><span>Impressions</span></div><div><strong title="${full(v.views)} plays">${compact(v.views)}</strong><span>Video plays</span></div></div>
  </article>`;
}

function table() {
  return `<table class="index-table"><thead><tr><th>Ref.</th><th>Video / creator</th><th>Category</th><th>Launch date</th><th>Impressions</th><th>Plays</th><th>Likes</th><th>Bookmarks</th><th>Duration</th></tr></thead><tbody>${filtered.map(v => `<tr><td>${pad(v.id)}</td><td><button data-open="${v.id}">▶ ${escapeHTML(v.title)}</button><br><span class="byline">${escapeHTML(v.account)}</span></td><td>${escapeHTML(v.category)}</td><td><time datetime="${escapeHTML(v.date)}" title="Original launch post date (PT)">${launchDate(v.date)}</time></td><td>${full(v.impressions)}${v.flag ? ' △' : ''}</td><td>${full(v.views)}</td><td>${full(v.likes)}</td><td>${full(v.bookmarks)}</td><td>${timecode(v.clipSeconds)}${v.excerpt ? '*' : ''}</td></tr>`).join('')}</tbody></table>`;
}

function renderCollection() {
  document.querySelectorAll('.inline-player video').forEach(player => player.pause());
  const query = $('#search').value.trim().toLowerCase();
  const category = $('#category').value;
  const style = $('#style').value;
  const sort = $('#sort').value;
  filtered = videos.filter(v => {
    const haystack = [v.title,v.originalTitle,v.account,v.category,...v.styles,...v.notes,...v.originalNotes].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (category === 'all' || category === v.category) && (style === 'all' || v.styles.includes(style));
  }).sort((a,b) => sort === 'date' ? b.date.localeCompare(a.date) : sort === 'oldest' ? a.date.localeCompare(b.date) : b[sort] - a[sort]);
  $('#result-count').textContent = filtered.length;
  $('#result-count').setAttribute('aria-label', `${filtered.length} videos`);
  $('#collection').classList.toggle('table-view', tableView);
  $('#collection').innerHTML = filtered.length ? (tableView ? table() : filtered.map(card).join('')) : '';
  $('#empty').hidden = filtered.length > 0;
}

function setFeature(id) {
  const v = videos.find(v => v.id === id);
  if (!v) return;
  const player = $('#featured-video');
  player.dataset.referenceId = String(id);
  player.dataset.surface = 'featured';
  player.pause();
  player.poster = v.poster;
  player.src = v.video;
  player.setAttribute('aria-label', `${v.title} launch video`);
  $('#featured-duration').textContent = displayDuration(v);
  $('#featured-info').innerHTML = `<h3>${escapeHTML(v.title)}</h3><div class="byline">${escapeHTML(v.account)}</div><div class="launch-date" title="Date of the original launch post (PT)">Launch date · <time datetime="${escapeHTML(v.date)}">${launchDate(v.date)}</time></div><div class="featured-stats"><div><strong>${compact(v.impressions)}</strong><span>Impressions</span></div><div><strong>${compact(v.views)}</strong><span>Video plays</span></div></div><button class="text-link" data-open="${v.id}">View details ↗</button>`;
  document.querySelectorAll('[data-feature]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.feature) === id)));
}

function brief(v) {
  return `Remake this video's motion and vibe for my product: ${v.source}`;
}

function openVideo(id, trigger) {
  const v = videos.find(v => v.id === id);
  if (!v) return;
  track('reference_opened',{reference_id:id,surface:trigger ? 'collection' : 'reference_link'});
  document.querySelectorAll('video').forEach(player => player.pause());
  const oldPlayer = $('#dialog-video');
  if (oldPlayer) oldPlayer.pause();
  activeId = id;
  if (trigger) lastTrigger = trigger;
  $('#dialog-ref').textContent = v.title;
  const metrics = [['impressions','Impressions'],['views','Video plays'],['likes','Likes'],['bookmarks','Bookmarks'],['reposts','Reposts'],['replies','Replies'],['quotes','Quotes'],['followers','Followers']];
  $('#dialog-content').innerHTML = `<div class="dialog-main"><div class="dialog-left">
    <video id="dialog-video" controls playsinline preload="metadata" data-reference-id="${v.id}" data-surface="detail" poster="${v.poster}" src="${v.video}" aria-label="${escapeHTML(v.title)} video"></video>
    <p class="video-error" id="media-error" hidden>Unable to play this file. <a href="${v.source}" target="_blank" rel="noopener">Watch the original post ↗</a></p>
    <div class="clip-note"><span>${displayDuration(v)}</span><a href="${v.source}" target="_blank" rel="noopener">Original post ↗</a></div>
    <h2 id="dialog-title">${escapeHTML(v.title)}</h2>
    <div class="byline">${escapeHTML(v.account)} · Posted ${v.date}</div>
    <div class="dialog-tags">${v.styles.map(s => escapeHTML(s)).join(' / ')}</div>
    <div class="reference-feedback" aria-label="Was this reference useful?"><span>Useful reference?</span><button data-feedback="helpful" aria-label="Helpful reference">Yes</button><button data-feedback="not_helpful" aria-label="Not a helpful reference">No</button></div>
    <h3>What to borrow</h3><ul class="notes-list">${v.notes.map(note => `<li>${escapeHTML(note)}</li>`).join('')}</ul>
    <details><summary>Original post</summary><blockquote>${escapeHTML(v.quote)}</blockquote></details>
  </div><aside class="dialog-right"><h3 class="stats-heading">Stats</h3>
    <div class="stat-grid">${metrics.map(([key,label]) => `<div><strong>${full(v[key])}</strong><span>${label}</span></div>`).join('')}</div>
    ${v.flag ? `<p class="metric-warning">△ Plays are only ${(v.views / v.impressions * 100).toFixed(2)}% of impressions. A low ratio alone does not establish organic reach or paid promotion.</p>` : ''}
    <details class="file-details"><summary>File & post metadata</summary><table class="metadata-table"><tbody>
      <tr><td title="Date of the original launch post (PT)">Launch date</td><td>${v.date}</td></tr><tr><td>Original duration</td><td>${timecode(v.originalSeconds)}</td></tr><tr><td>Included footage</td><td>${timecode(v.clipSeconds)}${v.excerpt ? ' / Excerpt' : ' / Full clip'}</td></tr><tr><td>Aspect ratio</td><td>${v.ratio}</td></tr><tr><td>Reference resolution</td><td>${v.width} × ${v.height}</td></tr><tr><td>Audio track</td><td>${v.hasAudio ? 'Yes' : 'None'}</td></tr><tr><td>Plays / impressions</td><td>${v.views == null || !v.impressions ? '—' : `${(v.views / v.impressions * 100).toFixed(2)}%`}</td></tr><tr><td>Data snapshot</td><td>${escapeHTML(v.snapshotDate || '2026-10-27')} PT</td></tr>
    </tbody></table></details>
    <details class="brief-details"><summary>AI remake brief</summary><label class="sr-only" for="remake-brief">Editable AI remake brief</label><textarea id="remake-brief" class="brief-text" spellcheck="false">${escapeHTML(brief(v))}</textarea><button id="copy-brief" class="solid-button">Copy AI remake brief <span aria-hidden="true">↗</span></button></details>
  </aside></div>`;
  $('#dialog-video').addEventListener('error', () => { $('#media-error').hidden = false; });
  $('#dialog-video').addEventListener('play', () => $('#featured-video').pause());
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  document.body.classList.add('modal-open');
  history.replaceState(null, '', `#video-${id}`);
  const sequence = filtered.length ? filtered : videos;
  $('#prev-video').disabled = sequence.length < 2;
  $('#next-video').disabled = sequence.length < 2;
}

function navigateVideo(direction) {
  const sequence = filtered.length ? filtered : videos;
  let index = sequence.findIndex(v => v.id === activeId);
  if (index === -1) index = 0;
  openVideo(sequence[(index + direction + sequence.length) % sequence.length].id);
}

async function copyBrief() {
  const textarea = $('#remake-brief');
  try {
    await navigator.clipboard.writeText(textarea.value);
    track('reference_prompt_copied',{reference_id:activeId});
    const button = $('#copy-brief');
    button.textContent = 'Copied ✓';
    notify('Brief copied. Make it yours.');
    setTimeout(() => { if (button.isConnected) button.innerHTML = 'Copy AI remake brief ↗'; }, 2000);
  } catch {
    textarea.focus();
    textarea.select();
    notify('Select and copy the brief with ⌘C / Ctrl+C.');
  }
}

document.addEventListener('click', (event) => {
  const play = event.target.closest('[data-play]');
  if (play) {
    const player = play.closest('.inline-player').querySelector('video');
    play.disabled = true;
    player.play().catch(() => {
      notify('Unable to start playback. Try the player controls.');
    }).finally(() => { play.disabled = false; });
  }
  const open = event.target.closest('[data-open]');
  if (open) openVideo(Number(open.dataset.open), open);
  const feature = event.target.closest('[data-feature]');
  if (feature) setFeature(Number(feature.dataset.feature));
  if (event.target.closest('#copy-brief')) copyBrief();
  const feedback=event.target.closest('[data-feedback]');
  if (feedback && !feedback.disabled) {
    feedback.closest('.reference-feedback').querySelectorAll('button').forEach(button=>button.disabled=true);
    track('reference_feedback',{reference_id:activeId,rating:feedback.dataset.feedback}).then(recorded=>{
      if (recorded) notify('Thanks — noted.');
      else {feedback.closest('.reference-feedback')?.querySelectorAll('button').forEach(button=>button.disabled=false);notify('Feedback was not sent.');}
    });
  }
});
document.addEventListener('play', (event) => {
  if (!(event.target instanceof HTMLVideoElement)) return;
  const id = Number(event.target.dataset.referenceId);
  if (id && !playedReferences.has(id)) {
    playedReferences.add(id);
    track('reference_played',{reference_id:id,surface:event.target.dataset.surface});
  }
  document.querySelectorAll('video').forEach(player => {
    if (player !== event.target) player.pause();
  });
  event.target.closest('.inline-player')?.classList.add('is-playing');
}, true);
document.addEventListener('timeupdate', event => {
  const player = event.target;
  if (!(player instanceof HTMLVideoElement) || player.seeking) return;
  const id = Number(player.dataset.referenceId);
  if (!id || engagedReferences.has(id)) return;
  let seconds = 0;
  for (let i = 0; i < player.played.length; i++) seconds += player.played.end(i) - player.played.start(i);
  if (seconds >= 5) {
    engagedReferences.add(id);
    track('reference_engaged',{reference_id:id,surface:player.dataset.surface});
  }
}, true);
['pause', 'ended'].forEach(type => document.addEventListener(type, (event) => {
  if (event.target instanceof HTMLVideoElement) event.target.closest('.inline-player')?.classList.remove('is-playing');
}, true));
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#prev-video').addEventListener('click', () => navigateVideo(-1));
$('#next-video').addEventListener('click', () => navigateVideo(1));
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
});
dialog.addEventListener('close', () => {
  const player = $('#dialog-video');
  if (player) player.pause();
  document.body.classList.remove('modal-open');
  history.replaceState(null, '', '#archive');
  if (lastTrigger?.isConnected) lastTrigger.focus({preventScroll:true});
});
document.addEventListener('keydown', (event) => {
  if (!dialog.open || /INPUT|TEXTAREA|SELECT|VIDEO/.test(event.target.tagName)) return;
  if (event.key === 'ArrowRight') {event.preventDefault();navigateVideo(1);}
  if (event.key === 'ArrowLeft') {event.preventDefault();navigateVideo(-1);}
});
function filterChanged() {
  renderCollection();
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => track('collection_filtered',{query_length:$('#search').value.trim().length,result_count:filtered.length,category:$('#category').value,style:$('#style').value,sort:$('#sort').value}),500);
}
$('#search').addEventListener('input', filterChanged);
['category','style','sort'].forEach(id => $(`#${id}`).addEventListener('change', filterChanged));
$('#reset-filters').addEventListener('click', () => {
  $('#search').value = '';
  $('#category').value = 'all';
  $('#style').value = 'all';
  renderCollection();
});
$('#view-toggle').addEventListener('click', () => {
  tableView = !tableView;
  $('#view-toggle').innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${tableView ? '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' : '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>'}</svg>`;
  $('#view-toggle').setAttribute('aria-label', tableView ? 'Switch to grid view' : 'Switch to table view');
  $('#view-toggle').title = tableView ? 'Switch to grid view' : 'Switch to table view';
  renderCollection();
});
$('#featured-video').addEventListener('error', () => notify('Unable to play the reference file. Open the original post.'));

fetch('videos.json').then(response => {
  if (!response.ok) throw new Error('Unable to load metadata');
  return response.json();
}).then(data => {
  videos = data;
  for (const [id, values, label] of [['category',videos.map(v=>v.category),'All categories'],['style',videos.flatMap(v=>v.styles),'All styles']]) {
    document.getElementById(id).innerHTML = `<option value="all">${label}</option>` + [...new Set(values)].sort().map(value=>`<option>${escapeHTML(value)}</option>`).join('');
  }
  $('#total-videos').textContent = videos.length;
  $('#total-impressions').textContent = compact(videos.reduce((n,v) => n + (v.impressions ?? 0), 0));
  fetch('daily-stats.json').then(r => { if (!r.ok) throw new Error('No daily snapshot'); return r.json(); }).then(history => {
    const comparison = dailyChanges(videos, history);
    if (!comparison) return;
    for (const [metric, change] of Object.entries(comparison.changes)) {
      const badge = $(`#delta-${metric}`);
      if (!badge) continue;
      badge.textContent = change > 0 ? `↑ +${compact(change)}` : change < 0 ? `↓ −${compact(-change)}` : '0';
      badge.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
      badge.title = `Collection total vs yesterday (${comparison.yesterday}, PT). Includes newly added references; not daily traffic or same-post growth.`;
      badge.setAttribute('aria-label', `${metric}: ${change > 0 ? '+' : ''}${change.toLocaleString('en-US')} vs yesterday`);
      badge.hidden = false;
    }
  }).catch(() => {});
  setFeature(87);
  renderCollection();
  const match = location.hash.match(/^#video-(\d+)$/);
  if (match) openVideo(Number(match[1]));
}).catch(() => {
  $('#collection').innerHTML = '<p class="video-error">The collection could not load. Refresh the page, or <a href="videos.json">open the metadata file</a>.</p>';
});

document.addEventListener('error',event=>{
  const player=event.target;
  if (!(player instanceof HTMLVideoElement)) return;
  const id=Number(player.dataset.referenceId);
  if(id) track('reference_failed',{reference_id:id,surface:player.dataset.surface,reason:'media_error',error_code:player.error?.code});
},true);
