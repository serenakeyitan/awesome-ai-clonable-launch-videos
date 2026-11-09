# Clerk OAuth rollout

Status: Clerk Google OAuth is enabled in production. Anonymous MCP requests receive a 401 challenge. Plugin 0.1.2 is published with OAuth and the existing private audience. DNS, certificates, mail records and Google production credentials are verified. Real Google sign-in, PKCE token exchange and authenticated calls to all three tools passed with both modern and legacy MCP clients, each reading the current 74-video catalog.

The public gallery and video assets remain accessible without signing in. MCP uses Clerk OAuth with `profile` and `email`; Clerk stores the account and verified email. Authentication does not subscribe the user to email updates. No email or token is returned to the agent.

## Provider setup

- Clerk application: `app_3LkVh87NlDpgcVKaOkA8NuugYhi` (Serena Launch).
- Production instance: `ins_3LkVo2h1Xdi66pIhBLzzjLLUAq9`.
- OAuth resource: `oares_3LkWAfoJkNu9faX0rpeen7rsNgo`.
- Resource and token audience: `https://serenatan.org/launchvideo/mcp`.
- Google Cloud project: `launch-archive-513920` (independent of other products).

Add the following CNAME records in Cloudflare with proxying disabled. Preserve existing records and incoming email configuration; do not overwrite a conflicting record.

| Name | Target |
| --- | --- |
| `clerk` | `frontend-api.clerk.services` |
| `accounts` | `accounts.clerk.services` |
| `clkmail` | `mail.1u7i3axux7q3.clerk.services` |
| `clk._domainkey` | `dkim1.1u7i3axux7q3.clerk.services` |
| `clk2._domainkey` | `dkim2.1u7i3axux7q3.clerk.services` |

The Google OAuth web client needs origins `https://serenatan.org` and `https://www.serenatan.org`, and redirect URI `https://clerk.serenatan.org/v1/oauth_callback`. Store its secret directly in Clerk, never in source or chat. The Google web client has been created, securely configured in Clerk, and published with status In production. Its client ID is `117571238018-55f1pn3d0p8ka5e9h17gbke88fjvl95b.apps.googleusercontent.com`. The homepage and privacy links are configured; the public privacy page is deployed. Cloudflare DNS, SSL and mail DNS checks are complete.

The Clerk production instance already has the MCP resource registered, audience claims and JWT access tokens enabled, PKCE required, and CIMD/DCR enabled for client compatibility. Dynamic clients are limited to `openid`, `profile`, `email`, and `offline_access`; default scopes are `openid`, `profile`, and `email`.

## Release and verification procedure

1. Run `npx clerk@4.1.0 deploy status` in this linked project. DNS, SSL, mail DNS, and Google credentials must be ready.
2. Retrieve keys with `npx clerk@4.1.0 env pull --instance prod --file .env.production.local`. This file is ignored. Transfer the secret to the existing Worker using Wrangler secret input, without printing it or passing it in command arguments.
3. Add `CLERK_PUBLISHABLE_KEY` and `CLERK_ISSUER=https://clerk.serenatan.org` to Worker variables and set `CLERK_SECRET_KEY` as a secret. Add an exact route for `serenatan.org/.well-known/oauth-protected-resource/launchvideo/mcp` to this Worker. Set `CLERK_AUTH_ENABLED=true` only for the coordinated auth release.
4. The served and packaged SKILL.md, manifest, setup documentation, and both plugin MCP declarations use OAuth. Publish them with the authenticated backend. Keep the existing endpoint and tools. Tell existing users to reconnect once. An auth change cannot silently grant new permissions.
5. Run `npm test` and a Wrangler dry run. Deploy the coordinated release, then verify anonymous MCP requests receive a `401` OAuth challenge, metadata is public, invalid tokens are rejected, browser preflight succeeds, and a real signed-in client can call all three tools. Recheck the public gallery.
6. Publish the plugin update only with the working auth backend. Keep its existing ID, private audience, default prompt and assets; bump the package version and verify source read-back.

The guard uses Clerk's SDK, accepts only OAuth access tokens, and checks the exact resource audience and both required scopes. The existing per-IP abuse throttle and request body cap run before authentication. Signature, expiry, audience, scope, anonymous discovery and Worker dispatch behavior are covered by tests. These tests are not a substitute for a real Google sign-in and client authorization.

References: [Clerk MCP authentication](https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server), [Clerk Google production setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google).

## Verification record (2026-11-06)

- 18 automated tests pass, including signed Clerk OAuth-token fixtures and signature, expiry, scope and audience rejection. Wrangler packaging passes.
- Production MCP rejects anonymous calls with a 401 and the correct resource metadata challenge. Discovery and dynamic client registration succeed with the official MCP SDK; browser CORS preflight permits Authorization.
- The account owner completed Google passkey verification and consent in ordinary Chrome. PKCE token exchange succeeded. Modern and legacy official MCP clients initialized, listed all three tools, retrieved context, searched references and fetched video details. Both read 74 videos and verified a fresh catalog fetch on a repeated call within the same connection.
- Plugin 0.1.2 was published under the existing plugin identity and source read-back confirms OAuth declarations. Existing installations must reconnect once.
