# Instagram and Depop sync architecture

VIGILKLINE currently has no Instagram or Depop connection. The UI must continue to show external metrics as unavailable until a successful, authorized sync stores real records.

## Connection boundaries

- Never accept or store Instagram or Depop passwords.
- Never scrape platform pages or automate a consumer login.
- Keep client IDs, client secrets, access tokens, refresh tokens, and webhook secrets in encrypted server-side storage or hosting secrets. They must never be included in browser bundles, IndexedDB, logs, or the repository.
- Use OAuth authorization code flow and PKCE where the provider supports it. Generate a short-lived, single-use `state` value on the server and validate it on callback.
- Ask only for scopes required for the visible product features. Record account, scope, expiry, last successful sync, and last error so the UI can report the true state.
- Support disconnect and provider-side revocation. Deleting a connection must revoke tokens when supported and stop scheduled syncs.

## Server endpoints to add after provider setup

The browser-facing UX is prepared, but these endpoints should remain absent or return an explicit unavailable response until credentials and persistence are ready.

1. `GET /api/integrations/status` — returns sanitized connection and sync status only.
2. `POST /api/integrations/meta/start` — creates state/PKCE records and redirects to Meta authorization.
3. `GET /api/integrations/meta/callback` — validates state, exchanges the code server-side, encrypts tokens, selects the authorized professional account, and queues the first sync.
4. `POST /api/integrations/depop/start` and callback — enable only after Depop approves the applicable API or partner access.
5. `POST /api/integrations/:provider/disconnect` — revokes and deletes the connection.
6. Provider webhooks and/or scheduled sync jobs — verify signatures, use idempotency keys, and store provider record IDs and timestamps.

## Normalized data model

- `connections`: provider, account ID, display name, granted scopes, token reference, expiry, state, last sync, last error.
- `content`: provider content ID, published time, media type, permalink, caption summary, campaign tags.
- `content_metrics`: content ID, metric name, value, provider timestamp, fetched time.
- `channel_listings`: provider listing ID, inventory item ID, status, asking price, published time.
- `channel_sales`: provider transaction ID, inventory item ID, gross revenue, fees, net revenue, sold time.
- `attribution`: content ID, sale ID, attribution source and method. Conversion must remain unavailable when no defensible attribution signal exists.

Financial charts can use local VIGILKLINE records immediately. Instagram engagement, Depop sales, and cross-channel conversion must use only normalized provider records from successful syncs; never generate placeholder metrics.

## Deployment checklist

1. Create the Meta developer app, configure the production HTTPS redirect URI, and complete the current review requirements for the professional-account data requested.
2. Obtain Depop-approved access and confirm its permitted endpoints, authentication flow, storage, and display terms.
3. Add secrets in the production hosting environment, configure an encrypted token store, and add CSRF/state, PKCE, callback, revocation, rate-limit, retry, and audit handling.
4. Add privacy disclosures and deletion/disconnect controls before inviting account authorization.
5. Test expired tokens, revoked permissions, partial data, duplicate webhooks, delayed syncs, and provider outages. The UI should show last-sync and error states without falling back to fabricated data.
