# Supabase shared-workspace phase

The app still uses IndexedDB and works offline. No cloud client is created unless both public Supabase variables are configured. This phase prepares real authentication and one shared workspace for 2–3 friends; it does not imitate shared state locally.

## Prepared in this repository

- `@supabase/supabase-js` and `@supabase/ssr` dependencies.
- A lazy browser client in `lib/supabase/client.ts` that returns `null` while unconfigured.
- A request-scoped SSR client in `lib/supabase/server.ts`; no service-role credential is used.
- `supabase/migrations/202608120001_shared_workspace.sql` with workspace membership, owner/member roles, inventory, store segments and candidates, calendar entries, tax settings/payments, private photo storage, indexes, and row-level security.
- Existing IndexedDB persistence remains the offline source of truth until an authenticated sync layer is deliberately enabled.

## Exact next user step

Create a Supabase project in the Supabase dashboard. Then run the migration in its SQL editor or with the Supabase CLI. In Vercel project settings, add these environment variables using values from **Supabase → Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`: the project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable key (called the anon key on older projects).

Do not paste either value into chat or commit it. Do not expose the service-role key to the browser; reserve it for narrowly scoped server jobs only if a later phase truly needs it.

## Implementation sequence after configuration

1. Add Supabase Auth sign-in, session-refresh middleware, and a protected workspace chooser. Keep authorization checks in RLS even after the UI is protected.
2. Call the migration-provided `create_workspace` RPC so workspace creation and the creator’s `owner` membership happen in one transaction.
3. Add owner-only invitations and membership management. Members can edit operational records; only owners can rename/delete the workspace or manage members.
4. Add a sync adapter between IndexedDB records and Supabase tables. Assign stable UUIDs locally, track `updated_at`, queue offline mutations, retry idempotently, and surface conflicts rather than silently overwriting.
5. Upload compressed photos to the private `workspace-photos` bucket at `<workspace-id>/<item-or-candidate-id>/<filename>`. Store only the path in records and use short-lived signed URLs for display.
6. Subscribe to workspace-scoped Realtime changes only after membership is verified. Re-fetch after reconnection because Realtime is not a durable event queue.
7. Provide a one-time, reviewable migration from the current device-local workspace. Keep IndexedDB as a cache/offline queue after cloud sync activates.
8. Add integration tests with two users in one workspace and a third non-member. Verify every table and photo path rejects cross-workspace access.

## Security decisions

- Authorization lives in Postgres RLS, not merely hidden UI.
- All business tables carry `workspace_id`; queries must always be workspace-scoped.
- The browser uses only the publishable key and the signed-in user session.
- Photos are private. Do not use public bucket URLs.
- Finance writes are allowed to members in the initial schema; change those policies to owner-only if the group wants tighter bookkeeping controls.
- Workspace deletion and ownership transfer should be separate, explicit server-side actions with audit logging.
