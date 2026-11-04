'use strict';

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = (value) => String(value).padStart(3, '0');
const full = (value) => value == null ? '—' : value.toLocaleString('en-US');
const compact = (value) => value == null ? '—' : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : String(value);
const timecode = (seconds) => {
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};
const displayDuration = (video) => `${timecode(video.clipSeconds)}${video.excerpt ? ` EXCERPT / ${timecode(video.originalSeconds)} ORIGINAL` : ''}`;
let videos = [];
let filtered = [];
let activeId = null;
let tableView = false;
let toastTimer;
let lastTrigger;
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
      <video controls playsinline preload="none" poster="${v.poster}" src="${v.video}" aria-label="${escapeHTML(v.title)} inline video"></video>
      <button class="inline-play play-icon" data-play="${v.id}" aria-label="Play ${escapeHTML(v.title)}">▶</button>
      ${v.excerpt ? '<span class="excerpt-label">EXCERPT</span>' : ''}<span class="timecode">${timecode(v.clipSeconds)}</span>
    </div>
    <div class="card-title-row"><h3>${escapeHTML(v.title)}</h3><button class="details-link" data-open="${v.id}" aria-label="View ${escapeHTML(v.title)} details">Details ↗</button></div>
    <div class="byline">${escapeHTML(v.account)}</div>
    <div class="card-metrics"><div><strong title="${full(v.impressions)} impressions">${compact(v.impressions)} ${v.flag ? '<span class="flag-mark" title="Video plays are below 3% of impressions">△</span>' : ''}</strong><span>IMPRESSIONS</span></div><div><strong title="${full(v.views)} plays">${compact(v.views)}</strong><span>VIDEO PLAYS</span></div></div>
  </article>`;
}

function table() {
  return `<table class="index-table"><thead><tr><th>REF.</th><th>VIDEO / POSTING ACCOUNT</th><th>CATEGORY</th><th>IMPRESSIONS</th><th>PLAYS</th><th>LIKES</th><th>BOOKMARKS</th><th>DURATION</th></tr></thead><tbody>${filtered.map(v => `<tr><td>${pad(v.id)}</td><td><button data-open="${v.id}">▶ ${escapeHTML(v.title)}</button><br><span class="byline">${escapeHTML(v.account)}</span></td><td>${escapeHTML(v.category)}</td><td>${full(v.impressions)}${v.flag ? ' △' : ''}</td><td>${full(v.views)}</td><td>${full(v.likes)}</td><td>${full(v.bookmarks)}</td><td>${timecode(v.clipSeconds)}${v.excerpt ? '*' : ''}</td></tr>`).join('')}</tbody></table>`;
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
  }).sort((a,b) => sort === 'date' ? b.date.localeCompare(a.date) : b[sort] - a[sort]);
  $('#result-count').textContent = `${filtered.length} videos`;
  $('#collection').classList.toggle('table-view', tableView);
  $('#collection').innerHTML = filtered.length ? (tableView ? table() : filtered.map(card).join('')) : '';
  $('#empty').hidden = filtered.length > 0;
}

function setFeature(id) {
  const v = videos.find(v => v.id === id);
  if (!v) return;
  const player = $('#featured-video');
  player.pause();
  player.poster = v.poster;
  player.src = v.video;
  player.setAttribute('aria-label', `${v.title} launch video`);
  $('#featured-duration').textContent = displayDuration(v);
  $('#featured-source').href = v.source;
  $('#featured-info').innerHTML = `<h3>${escapeHTML(v.title)}</h3><div class="byline">${escapeHTML(v.account)}</div><div class="featured-stats"><div><strong>${compact(v.impressions)}</strong><span>IMPRESSIONS</span></div><div><strong>${compact(v.views)}</strong><span>VIDEO PLAYS</span></div></div><button class="text-link" data-open="${v.id}">VIEW DETAILS ↗</button>`;
  document.querySelectorAll('[data-feature]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.feature) === id)));
}

function brief(v) {
  return `clone this video 1:1 for my product ${v.source}`;
}

function openVideo(id, trigger) {
  const v = videos.find(v => v.id === id);
  if (!v) return;
  document.querySelectorAll('video').forEach(player => player.pause());
  const oldPlayer = $('#dialog-video');
  if (oldPlayer) oldPlayer.pause();
  activeId = id;
  if (trigger) lastTrigger = trigger;
  $('#dialog-ref').textContent = v.title;
  const metrics = [['impressions','IMPRESSIONS'],['views','VIDEO PLAYS'],['likes','LIKES'],['bookmarks','BOOKMARKS'],['reposts','REPOSTS'],['replies','REPLIES'],['quotes','QUOTES'],['followers','FOLLOWERS']];
  $('#dialog-content').innerHTML = `<div class="dialog-main"><div class="dialog-left">
    <video id="dialog-video" controls playsinline preload="metadata" poster="${v.poster}" src="${v.video}" aria-label="${escapeHTML(v.title)} video"></video>
    <p class="video-error" id="media-error" hidden>Unable to play this file. <a href="${v.source}" target="_blank" rel="noopener">Watch the original post ↗</a></p>
    <div class="clip-note"><span>${displayDuration(v)}</span><a href="${v.source}" target="_blank" rel="noopener">ORIGINAL POST ↗</a></div>
    <h2 id="dialog-title">${escapeHTML(v.title)}</h2>
    <div class="byline">${escapeHTML(v.account)} · POSTED ${v.date}</div>
    <div class="dialog-tags">${v.styles.map(s => escapeHTML(s.toUpperCase())).join(' / ')}</div>
    <h3>WHAT TO BORROW</h3><ul class="notes-list">${v.notes.map(note => `<li>${escapeHTML(note)}</li>`).join('')}</ul>
    <details><summary>Original post</summary><blockquote>${escapeHTML(v.quote)}</blockquote></details>
  </div><aside class="dialog-right"><h3 class="stats-heading">STATS</h3>
    <div class="stat-grid">${metrics.map(([key,label]) => `<div><strong>${full(v[key])}</strong><span>${label}</span></div>`).join('')}</div>
    ${v.flag ? `<p class="metric-warning">△ Plays are only ${(v.views / v.impressions * 100).toFixed(2)}% of impressions. A low ratio alone does not establish organic reach or paid promotion.</p>` : ''}
    <details class="file-details"><summary>File & post metadata</summary><table class="metadata-table"><tbody>
      <tr><td>Post date</td><td>${v.date}</td></tr><tr><td>Original duration</td><td>${timecode(v.originalSeconds)}</td></tr><tr><td>Included footage</td><td>${timecode(v.clipSeconds)}${v.excerpt ? ' / EXCERPT' : ' / FULL CLIP'}</td></tr><tr><td>Aspect ratio</td><td>${v.ratio}</td></tr><tr><td>Reference resolution</td><td>${v.width} × ${v.height}</td></tr><tr><td>Audio track</td><td>${v.hasAudio ? 'YES' : 'NONE'}</td></tr><tr><td>Plays / impressions</td><td>${v.views == null || !v.impressions ? '—' : `${(v.views / v.impressions * 100).toFixed(2)}%`}</td></tr><tr><td>Data snapshot</td><td>${escapeHTML(v.snapshotDate || '2026-10-27')} PT</td></tr>
    </tbody></table></details>
    <details class="brief-details"><summary>AI remake brief</summary><label class="sr-only" for="remake-brief">Editable AI remake brief</label><textarea id="remake-brief" class="brief-text" spellcheck="false">${escapeHTML(brief(v))}</textarea><button id="copy-brief" class="solid-button">COPY AI REMAKE BRIEF <span aria-hidden="true">↗</span></button></details>
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
    const button = $('#copy-brief');
    button.textContent = 'COPIED ✓';
    notify('BRIEF COPIED. MAKE IT YOURS.');
    setTimeout(() => { if (button.isConnected) button.innerHTML = 'COPY AI REMAKE BRIEF ↗'; }, 2000);
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
});
document.addEventListener('play', (event) => {
  if (!(event.target instanceof HTMLVideoElement)) return;
  document.querySelectorAll('video').forEach(player => {
    if (player !== event.target) player.pause();
  });
  event.target.closest('.inline-player')?.classList.add('is-playing');
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
$('#search').addEventListener('input', renderCollection);
['category','style','sort'].forEach(id => $(`#${id}`).addEventListener('change', renderCollection));
$('#reset-filters').addEventListener('click', () => {
  $('#search').value = '';
  $('#category').value = 'all';
  $('#style').value = 'all';
  renderCollection();
});
$('#view-toggle').addEventListener('click', () => {
  tableView = !tableView;
  $('#view-toggle').textContent = tableView ? '[ GRID ]' : '[ TABLE ]';
  $('#view-toggle').setAttribute('aria-label', tableView ? 'Switch to grid view' : 'Switch to table view');
  renderCollection();
});
$('#featured-video').addEventListener('error', () => notify('Unable to play the reference file. Open the original post.'));

fetch('videos.json').then(response => {
  if (!response.ok) throw new Error('Unable to load metadata');
  return response.json();
}).then(data => {
  videos = data;
  for (const [id, values, label] of [['category',videos.map(v=>v.category),'ALL CATEGORIES'],['style',videos.flatMap(v=>v.styles),'ALL STYLES']]) {
    document.getElementById(id).innerHTML = `<option value="all">${label}</option>` + [...new Set(values)].sort().map(value=>`<option>${escapeHTML(value)}</option>`).join('');
  }
  $('#total-videos').textContent = videos.length;
  $('#total-impressions').textContent = compact(videos.reduce((n,v) => n + v.impressions, 0));
  $('#total-views').textContent = compact(videos.reduce((n,v) => n + v.views, 0));
  setFeature(3);
  renderCollection();
  const match = location.hash.match(/^#video-(\d+)$/);
  if (match) openVideo(Number(match[1]));
}).catch(() => {
  $('#collection').innerHTML = '<p class="video-error">The collection could not load. Refresh the page, or <a href="videos.json">open the metadata file</a>.</p>';
});
