'use strict';
(() => {
  const endpoint = 'https://serenatan.org/launchvideo/mcp';
  const setup = 'set up https://serenatan.org/launchvideo/agent/SKILL.md';
  const esc = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const config = JSON.stringify({mcpServers:{'launch-archive':{url:endpoint}}},null,2);
  const clients = {
    claude:{name:'Claude',text:'Open Customize → Connectors → Add custom connector. Name it Launch Archive, paste the server URL below, and choose No sign in.',value:endpoint,link:'https://claude.ai/settings/connectors',label:'Open Claude ↗',extra:`Claude Code: claude mcp add --transport http launch-archive ${endpoint}`},
    chatgpt:{name:'ChatGPT',text:'Open Plugins, select + → Add custom MCP server. Paste the server URL below, choose No authentication, then create and install the plugin.',value:endpoint,link:'https://chatgpt.com/#settings',label:'Open ChatGPT ↗',extra:'Custom server access depends on your account and workspace settings.'},
    codex:{name:'Codex',text:'Run this in your terminal, or send the setup prompt above to Codex. Then ask: Find launch-video references for my product.',value:`codex mcp add launch-archive --url ${endpoint}`,link:'https://developers.openai.com/learn/docs-mcp',label:'Connection guide ↗'},
    cursor:{name:'Cursor',text:'Add this server to .cursor/mcp.json, keeping any existing servers. Enable Launch Archive in Cursor’s MCP settings.',value:config,link:'https://cursor.com/docs/mcp',label:'Cursor setup guide ↗'},
    grok:{name:'Grok',text:'Open Connectors → New Connector → Custom. Paste the server URL below and connect.',value:endpoint,link:'https://grok.com/connectors',label:'Open Grok connectors ↗',extra:'Business and Enterprise teams may need an admin to enable the connector.'},
    more:{name:'Gemini, VS Code, Raft & more',text:'Send the setup prompt to any agent with web access. If it supports remote MCP, use the server URL below. Otherwise it can read the live skill and catalog over HTTP.',value:endpoint,link:'https://github.com/serenakeyitan/awesome-ai-clonable-launch-videos/blob/main/agent/README.md',label:'All setup options ↗',extra:'VS Code: MCP: Add Server → HTTP. Gemini CLI: use httpUrl in your MCP configuration. Raft: send the setup prompt.'}
  };
  async function copy(value, button) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea'); input.value=value; input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();
        const copied = document.execCommand('copy');input.remove();if (!copied) throw new Error('Copy unavailable');
      }
      const label = button.getAttribute('aria-label');button.setAttribute('aria-label','Copied');
      const toast = document.getElementById('toast');toast.textContent='Copied to clipboard';toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2500);
      button.dataset.copied='true';setTimeout(()=>{button.removeAttribute('data-copied');if(label)button.setAttribute('aria-label',label);},2000);
    } catch {
      const toast = document.getElementById('toast');toast.textContent='Copy unavailable. Select and copy the text above.';toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),3500);
    }
  }
  document.getElementById('copy-setup').addEventListener('click',event=>copy(setup,event.currentTarget));
  document.querySelectorAll('button[data-client]').forEach(button=>button.addEventListener('click',()=>{
    const opened = button.getAttribute('aria-expanded')==='true';
    document.querySelectorAll('button[data-client]').forEach(b=>b.setAttribute('aria-expanded','false'));
    const panel=document.getElementById('client-setup');panel.hidden=opened;
    if(opened)return;
    button.setAttribute('aria-expanded','true');
    const client=clients[button.dataset.client];
    const vsCode = 'https://vscode.dev/redirect/mcp/install?' + new URLSearchParams({name:'launch-archive',config:JSON.stringify({type:'http',url:endpoint})});
    panel.innerHTML=`<h3>${esc(client.name)}</h3><p>${esc(client.text)}</p><pre><code>${esc(client.value)}</code></pre><button class="copy-config" aria-label="Copy ${esc(client.name)} connection configuration">COPY</button><a href="${client.link}" target="_blank" rel="noopener">${client.label}</a>${button.dataset.client==='more'?`<a class="vscode-install" href="${vsCode}" target="_blank" rel="noopener">Add to VS Code ↗</a>`:''}${client.extra?`<p class="client-note">${esc(client.extra)}</p>`:''}`;
    panel.querySelector('.copy-config').addEventListener('click',event=>copy(client.value,event.currentTarget));
  }));
})();

// The opener is a silent decorative loop; allow pause and respect reduced motion.
(() => {
  const video=document.getElementById('hero-mascot');
  const button=document.getElementById('mascot-control');
  if(!video||!button)return;
  video.muted=true;
  // Safari uses the paper-matched MP4; Chromium/Firefox can use VP9 alpha.
  const safari=/^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if(!safari&&video.canPlayType('video/webm; codecs="vp9"')) {
    video.src='mascot/serena-idle.webm';
    video.addEventListener('error',()=>{video.src='mascot/serena-idle.mp4';video.load();},{once:true});
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function sync(){const label=video.paused?'Play mascot animation':'Pause mascot animation';button.setAttribute('aria-label',label);button.title=label;button.querySelector('.mascot-play-state').textContent=video.paused?'▶':'Ⅱ';}
  function applyMotion(){if(reduced.matches){video.autoplay=false;video.pause();}else video.play().catch(()=>{});sync();}
  video.addEventListener('play',sync);video.addEventListener('pause',sync);
  button.addEventListener('click',()=>{if(video.paused)video.play().catch(()=>{});else video.pause();});
  reduced.addEventListener('change',applyMotion);applyMotion();
})();
