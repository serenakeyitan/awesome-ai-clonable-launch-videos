# Serena Launch branding

The product name is **Serena Launch** everywhere: website, repository heading, OAuth resource/consent labels, MCP title, plugin display name and skill display name. Use `serena-launch` for new client aliases and skill names. “Launch videos” describes the content, not a second product name.

Keep the immutable plugin package name, existing MCP server ID, rate-limit key, version header, repository URL and `/launchvideo/mcp` endpoint for compatibility. Existing users do not need a second connection or fresh OAuth grant to rename their local alias. Do not rewrite historical submission receipts.

- Website, plugin 0.1.5 and Clerk use the supplied popcorn mascot (`site/mascot/serena-popcorn.png`). The website mirrors and crops it through the existing `.intro-mascot` layout; the source PNG remains unchanged.
- Collection, setup guide and auxiliary pages share the popcorn-only `site/favicon.svg`, with PNG fallbacks for browser and touch icons. Keep it separate from the full mascot and plugin avatar.
- Clerk application: `app_3LkVh87NlDpgcVKaOkA8NuugYhi`. Application settings controls its name and uploaded logo. Account Portal → Customization uses Light mode, blue `#0000FF`, paper `#F4F4F4` and Flush elevation. Retain the existing authentication methods, OAuth resource and consent flow.
- The website prompt explicitly requests an OAuth MCP connection. The setup guide tells clients not to manufacture a downloadable skill as a substitute for connection. Some chat clients still require their own connector-settings step.
- Daily badges use `data/daily-stats.json`; regenerate through the README or site builder. They compare collection totals, including new references, rather than claiming daily source-platform growth or visitor tracking.

## Compact OAuth consent

`site/consent.html` hosts the custom consent page at `/launchvideo/consent.html`. It reuses the website colors and type, with the requesting application, signed-in account, requested scopes, core trust reminder and return domain visible. Additional explanations, client ID and full return URL are inside a native, initially closed `details` element. Allow and Deny remain explicit decisions.

The vanilla JavaScript flow uses Clerk's documented `oauthApplication.getConsentInfo()` and `buildConsentActionUrl()` APIs with the existing production instance. It does not change scopes, authentication, token validation, consent requirements or newsletter preferences. Native POST submission preserves the authorization parameters and includes only the user's clicked decision. Query parameters cannot supply a decision, organization or session override. The page has no analytics and uses no-store, anti-framing and a restricted CSP through `site/_headers`.

Deploy the page and verify its headers and assets before changing Clerk `paths.oauth_consent` to `/launchvideo/consent.html`. Read the public Frontend API environment back to confirm it resolves to `https://serenatan.org/launchvideo/consent.html`. Keep the previous configuration for rollback; never disable application consent. A local-only `consent.html?preview=1` design preview disables both decisions and does not load Clerk.

Source: [Clerk custom consent flow](https://clerk.com/docs/js-frontend/guides/configure/auth-strategies/oauth/custom-consent-page). Tests cover parameter integrity, decision/session overrides, redirect presentation and action destinations. Browser authorization is a separate acceptance check.
