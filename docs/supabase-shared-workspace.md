# Supabase shared workspaces

The app supports real Supabase email-link authentication and shared owner/member workspaces when public project configuration exists. Without it, the app compiles and continues as an IndexedDB-only workspace. Cloud mode maintains a workspace-scoped IndexedDB cache so an already-opened workspace can remain usable during a connection interruption.

## Implemented in this repository

- `@supabase/supabase-js` and `@supabase/ssr` dependencies.
- A lazy browser client in `lib/supabase/client.ts` that returns `null` while unconfigured.
- A request-scoped SSR client in `lib/supabase/server.ts`; no service-role credential is used.
- `supabase/migrations/202608120001_shared_workspace.sql` with workspace membership, owner/member roles, inventory, store segments and candidates, calendar entries, tax settings/payments, private photo storage, indexes, and row-level security.
- Secure email magic-link sign-in. The app never asks for an email password.
- Workspace listing and creation through the transaction-safe `create_workspace` RPC.
- Owner/member role display in the app shell.
- Explicit onboarding that either opens cloud data or copies local records into the cloud without replacing existing cloud records.
- Workspace-scoped sync for inventory, store sessions/candidates, calendar, finance settings/payments, and private photos.
- A current/baseline IndexedDB cache that preserves pending offline changes and retries them before pulling newer cloud data.
- Existing local IndexedDB data remains separate and available when the user switches back to local mode.

## Project setup

Run `supabase/migrations/202608120001_shared_workspace.sql` in the target Supabase project if it has not already been applied. In Vercel project settings, configure these values from **Supabase → Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`: the project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable key (called the anon key on older projects).

In **Supabase → Authentication → URL Configuration**, set the production Vercel URL as the Site URL and add its exact origin to Redirect URLs so email links return to the app.

Do not paste configuration values into chat or commit them. Do not expose the service-role key to the browser; the current implementation does not use it.

## Deliberate onboarding behavior

1. Signing in does not change the current data mode.
2. Opening a workspace shows local and cloud record counts before activation.
3. **Open cloud workspace** loads cloud records while retaining the local workspace unchanged.
4. **Copy local records into cloud, then open** inserts new copies and uploads photos to private storage; it does not replace existing cloud records.
5. Once cloud mode is active, edits save automatically. While the app is visible and fully synced, it pulls shared changes every 30 seconds; users can also refresh manually.
6. Pending changes remain in the workspace cache when offline and the workspace panel exposes an explicit retry action.
7. Switching back to local mode is blocked while a cloud write is actively syncing or pending, preventing an ambiguous handoff.

Owner-managed email invitations and membership administration are the next backend/UI increment. Until that is implemented, additional members must be provisioned through a trusted administrative workflow; do not expose service-role credentials in client code.

## Security decisions

- Authorization lives in Postgres RLS, not merely hidden UI.
- All business tables carry `workspace_id`; queries must always be workspace-scoped.
- The browser uses only the publishable key and the signed-in user session.
- Photos are private. Do not use public bucket URLs.
- Finance writes are allowed to members in the initial schema; change those policies to owner-only if the group wants tighter bookkeeping controls.
- Workspace deletion and ownership transfer should be separate, explicit server-side actions with audit logging.
