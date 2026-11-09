// Design preview only. Clerk rejected custom email HTML on the current free plan.
// This module is not imported by the production worker.
const HOME = 'https://serenatan.org/launchvideo/';
const MASCOT = `${HOME}mascot/serena-popcorn.png`;
const POPCORN = `${HOME}favicon-32.png?v=popcorn-1`;

function shell(title, content, footer) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f4;color:#111;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px">
<tr><td style="padding-bottom:40px;font:16px/1.5 'Courier New',monospace"><img src="${POPCORN}" width="26" height="26" alt="" style="vertical-align:middle;margin-right:10px">Serena Launch</td></tr>
<tr><td><img src="${MASCOT}" width="96" height="96" alt="Serena with popcorn" style="display:block;margin-bottom:24px"></td></tr>
<tr><td style="font-size:16px;line-height:1.65">${content}</td></tr>
<tr><td style="padding-top:36px;font:12px/1.7 'Courier New',monospace;color:#777">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}
const heading = value => `<h1 style="margin:0 0 22px;font:normal 30px/1.2 'Courier New',monospace;letter-spacing:-1px">${value}</h1>`;
const button = (url,label) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td style="background:#1717ff"><a href="${url}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font:15px/1.4 'Courier New',monospace">${label} ↗</a></td></tr></table>`;

export function signInTemplate() {
  return {
    name:'Serena Launch — new-device sign-in',
    subject:'New sign-in to Serena Launch',
    delivered_by_clerk:true,
    body:shell('New sign-in to Serena Launch',`${heading('A new device signed in.')}<p>Your Serena Launch account was just used on a new device. If this was you, you’re all set.</p><table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:24px 0;background:#ececec;font-size:14px">{{#if sign_in_method}}<tr><td style="padding:14px 16px 6px;color:#666">Sign-in type</td><td style="padding:14px 16px 6px">{{sign_in_method}}</td></tr>{{/if}}<tr><td style="padding:6px 16px;color:#666">Device</td><td style="padding:6px 16px">{{browser_name}} on {{operating_system}}</td></tr><tr><td style="padding:6px 16px;color:#666">Location</td><td style="padding:6px 16px">{{location}}</td></tr><tr><td style="padding:6px 16px 14px;color:#666">Time</td><td style="padding:6px 16px 14px">{{session_created_at}}</td></tr></table>{{#if revoke_session_url}}<p><strong>Don’t recognize this device?</strong><br>Sign it out and check your account.</p>${button('{{revoke_session_url}}','Sign out this device')}{{/if}}<p style="margin-top:30px">— Serena</p><p><a href="${HOME}" style="color:#1717ff">Back to the videos ↗</a></p>`,`Account security notification · Serena Launch<br>{{#if support_email}}<a href="mailto:{{support_email}}" style="color:#777">Need help?</a>{{/if}} · <a href="${HOME}privacy.html" style="color:#777">Privacy</a>`)
  };
}
