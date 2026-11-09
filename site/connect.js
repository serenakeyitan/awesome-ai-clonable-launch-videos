'use strict';
(() => {
  const endpoint = 'https://serenatan.org/launchvideo/mcp';
  const setup = `Connect to Serena Launch MCP at ${endpoint}.`;
  const copySetup = setup + ' If setup is needed in Claude, reply only with a "Connect Serena Launch" link to https://serenatan.org/launchvideo/agent/connect/claude.';
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
      toast.textContent='Copied to clipboard';toast.classList.add('visible');
      setTimeout(()=>{toast.classList.remove('visible');button.removeAttribute('data-copied');if(label)button.setAttribute('aria-label',label);if(text)text.textContent=originalText;},2000);
    } catch {
      toast.textContent='Copy unavailable. Select and copy the text.';toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),3500);
    }
  }
  document.getElementById('copy-setup').addEventListener('click',event=>copy(copySetup,event.currentTarget));
  document.querySelector('[data-client="codex"]').href = `codex://new?prompt=${encodeURIComponent(setup)}`;
  const setupButtons = [...document.querySelectorAll('button[data-client]')];
  const panel = document.getElementById('client-setup');
  const vsCode = 'https://vscode.dev/redirect/mcp/install?' + new URLSearchParams({name:'serena-launch',config:JSON.stringify({type:'http',url:endpoint})});
  const morePanel = `
    <div class="connection-option"><h3>VS Code</h3><a class="connection-action" href="${esc(vsCode)}" target="_blank" rel="noopener">Add server <span aria-hidden="true">↗</span></a></div>
    <details class="connection-option"><summary>Gemini CLI <span class="connection-disclosure">Configuration</span></summary><div class="connection-detail"><p>Add to <code>~/.gemini/settings.json</code>, then sign in when prompted.</p>${codeBlock('gemini','Copy Gemini configuration')}</div></details>
    <div class="connection-option"><h3>Raft</h3>${copyButton('prompt','Copy prompt',true)}</div>
    <div class="connection-option"><h3>Other apps</h3>${copyButton('url','Copy server URL',true)}</div>
    <details class="connection-option"><summary>Codex CLI <span class="connection-disclosure">Terminal commands</span></summary><div class="connection-detail"><p>Run these commands in order, then complete browser sign-in.</p>${codeBlock('codex','Copy Codex commands')}</div></details>`;
  const chatgptPanel = `<div class="connection-option"><h3>ChatGPT setup</h3><a class="connection-action" href="https://chatgpt.com/plugins" target="_blank" rel="noopener">Open Plugins <span aria-hidden="true">↗</span></a></div>
    <div class="connection-detail"><p>Select <strong>+ → Add custom MCP server</strong>. Name it <strong>Serena Launch</strong> and use this URL:</p>${codeBlock('url','Copy server URL')}<p class="connection-note">Choose OAuth, then create, install and sign in.</p></div>`;
  setupButtons.forEach(button=>button.addEventListener('click',()=>{
    const opened = button.getAttribute('aria-expanded') === 'true';
    setupButtons.forEach(other=>{other.setAttribute('aria-expanded','false');other.querySelector('span').textContent=other.dataset.client==='more' ? '+' : '⌄';});
    panel.hidden=opened;
    if(opened)return;
    button.setAttribute('aria-expanded','true');button.querySelector('span').textContent=button.dataset.client==='more' ? '−' : '⌃';
    panel.innerHTML=button.dataset.client==='chatgpt' ? chatgptPanel : morePanel;
  }));
  panel.addEventListener('click',event=>{
    const button=event.target.closest('button[data-copy]');
    if(button && panel.contains(button))copy(values[button.dataset.copy],button);
  });
})();
