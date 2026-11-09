'use strict';
(() => {
  const badge = document.getElementById('github-stars');
  const count = document.getElementById('github-star-count');
  if (!badge || !count) return;
  const show = value => {
    count.textContent = value;
    badge.setAttribute('aria-label', `${value} GitHub stars`);
    badge.hidden = false;
  };
  fetch('https://api.github.com/repos/serenakeyitan/awesome-ai-clonable-launch-videos', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(5000)
  }).then(response => {
    if (!response.ok) throw new Error('GitHub unavailable');
    return response.json();
  }).then(repo => {
    if (!Number.isSafeInteger(repo.stargazers_count) || repo.stargazers_count < 0) throw new Error('Invalid star count');
    show(new Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(repo.stargazers_count));
  }).catch(async () => {
    // Shields caches public counts, including when GitHub's anonymous limit is exhausted.
    try {
      const response = await fetch('https://img.shields.io/github/stars/serenakeyitan/awesome-ai-clonable-launch-videos.json', {signal:AbortSignal.timeout(5000)});
      if (!response.ok) return;
      const data = await response.json();
      if (/^\d[\d,.]*[kmb]?$/i.test(data.value)) show(data.value);
    } catch { /* Keep the repository link usable if both sources are unavailable. */ }
  });
})();
