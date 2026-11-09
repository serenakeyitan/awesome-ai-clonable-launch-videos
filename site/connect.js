'use strict';
import {track} from './analytics.mjs';
(() => {
  const endpoint = 'https://serenatan.org/launchvideo/mcp';
  const setup = `Connect to Serena Launch MCP at ${endpoint}.`;
  const esc = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copyIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1"/><path d="M15 8V3H3v13h5"/></svg>';
  const values = {
    prompt: setup,
    url: endpoint,
    gemini: JSON.stringify({mcpServers:{'serena-launch':{httpUrl:endpoint}}}, null, 2),
    codex: `codex mcp add serena-launch --url ${endpoint}\ncodex mcp login serena-launch`
  };
  const copyButton = (key, label, visible = false) => `<button class="copy-config${visible ? ' connection-action' : ''}" data-copy="${key}" aria-label="${esc(label)}" title="${esc(label)}">${copyIcon}${visible ? `<span data-copy-label>${esc(label)}</span>` : ''}</button>`;
  const codeBlock = (key, label) => `<div class="connection-code"><pre><code>${esc(values[key])}</code></pre>${copyButton(key,label)}</div>`;
  async function copy(value, button) {
    const label = button.getAttribute('aria-label');
    const text = button.querySelector('[data-copy-label]');
    const originalText = text?.textContent;
    const toast = document.getElementById('toast');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea'); input.value=value; input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();
        const copied = document.execCommand('copy');input.remove();if (!copied) throw new Error('Copy unavailable');
      }
      button.setAttribute('aria-label','Copied');button.dataset.copied='true';if(text)text.textContent='Copied';
      track('setup_prompt_copied',{placement:button.id === 'copy-setup' ? 'hero' : 'more',client:button.dataset.copy ?? 'agent'});
      toast.textContent='Copied to clipboard';toast.classList.add('visible');
      setTimeout(()=>{toast.classList.remove('visible');button.removeAttribute('data-copied');if(label)button.setAttribute('aria-label',label);if(text)text.textContent=originalText;},2000);
    } catch {
      toast.textContent='Copy unavailable. Select and copy the text.';toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),3500);
    }
  }
  document.getElementById('copy-setup').addEventListener('click',event=>copy(setup,event.currentTarget));
  document.querySelector('[data-client="claude"]').href = `claude://claude.ai/new?q=${encodeURIComponent(setup)}`;
  document.querySelector('[data-client="claude-code"]').href = `claude://code/new?q=${encodeURIComponent(setup)}`;
  document.querySelector('[data-client="codex"]').href = `codex://new?prompt=${encodeURIComponent(setup)}`;
  const setupButtons = [...document.querySelectorAll('button[data-client]')];
  const panel = document.getElementById('client-setup');
  const vsCode = 'https://vscode.dev/redirect/mcp/install?' + new URLSearchParams({name:'serena-launch',config:JSON.stringify({type:'http',url:endpoint})});
  const claudeWeb = 'https://claude.ai/customize/connectors?' + new URLSearchParams({modal:'add-custom-connector',connectorName:'Serena Launch',connectorUrl:endpoint});
  const morePanel = `
    <div class="connection-option"><h3>Claude web</h3><a class="connection-action" data-client="claude-web" href="${esc(claudeWeb)}" target="_blank" rel="noopener">Connect <span aria-hidden="true">↗</span></a></div>
    <details class="connection-option"><summary>ChatGPT <span class="connection-disclosure">Manual setup</span></summary><div class="connection-detail"><p>In <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener">Plugins ↗</a>, select <strong>+ → Add custom MCP server</strong>. Name it <strong>Serena Launch</strong>, paste this URL and choose OAuth. Create, install and sign in.</p>${codeBlock('url','Copy ChatGPT server URL')}</div></details>
    <div class="connection-option"><h3>VS Code</h3><a class="connection-action" href="${esc(vsCode)}" target="_blank" rel="noopener">Add server <span aria-hidden="true">↗</span></a></div>
    <details class="connection-option"><summary>Gemini CLI <span class="connection-disclosure">Configuration</span></summary><div class="connection-detail"><p>Add to <code>~/.gemini/settings.json</code>, then run <code>/mcp auth serena-launch</code> to sign in.</p>${codeBlock('gemini','Copy Gemini configuration')}</div></details>
    <div class="connection-option"><h3>Raft</h3>${copyButton('prompt','Copy prompt',true)}</div>
    <div class="connection-option"><h3>Other apps</h3>${copyButton('url','Copy server URL',true)}</div>
    <details class="connection-option"><summary>Codex CLI <span class="connection-disclosure">Terminal commands</span></summary><div class="connection-detail"><p>Run these commands in order, then complete browser sign-in.</p>${codeBlock('codex','Copy Codex commands')}</div></details>`;
  setupButtons.forEach(button=>button.addEventListener('click',()=>{
    const opened = button.getAttribute('aria-expanded') === 'true';
    setupButtons.forEach(other=>{other.setAttribute('aria-expanded','false');other.querySelector('span').textContent=other.dataset.client==='more' ? '+' : '⌄';});
    panel.hidden=opened;
    if(opened)return;
    button.setAttribute('aria-expanded','true');button.querySelector('span').textContent=button.dataset.client==='more' ? '−' : '⌃';
    panel.innerHTML=morePanel;
  }));
  panel.addEventListener('click',event=>{
    const button=event.target.closest('button[data-copy]');
    if(button && panel.contains(button))copy(values[button.dataset.copy],button);
  });
  document.addEventListener('click',event=>{
    const link = event.target.closest('a[data-client]');
    if (!link) return;
    const url = new URL(link.href,location.href);
    track('quick_connect_clicked',{client:link.dataset.client,destination:['claude:','codex:'].includes(url.protocol) ? 'desktop' : 'web'});
  });
})();
