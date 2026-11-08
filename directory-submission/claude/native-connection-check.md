# Claude native connection check — November 8, 2026

Status: not connected; no directory application submitted.

After the owner reported approving the Claude consent page, Chrome returned to Claude with: “Authorization with this connector failed. You can check your credentials and permissions.” Support reference: `ofid_435fd41a64b0b5bd`.

The existing Serena Launch custom connector is present, but its detail page says connection was started and not finished. No native Claude tool test has passed for this submission. The previously recorded official-SDK protocol checks remain separate evidence.

A retry of this same connector reached the branded Clerk consent page for Claude with profile/email access; the agent did not click Allow. No change to server authentication or security controls was made. The callback failure's cause has not been established. Clerk's discovery and Claude's public CIMD metadata are accessible, but this alone does not establish a successful OAuth code exchange.

The native custom connector is not an official directory submission. The application material remains in this folder; the earlier browser-local wizard draft may require reopening after OAuth redirected away from the wizard.
