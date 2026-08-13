import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, projectRoot), "utf8");

test("ships only the focused four-view navigation", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /type View = "dashboard" \| "inventory" \| "sessions" \| "finances"/);
  for (const label of ["Dashboard", "Inventory", "Sessions", "Finances"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(page, /id:\s*"listings"|id:\s*"orders"|id:\s*"performance"/i);
  assert.doesNotMatch(page, /function Listings\b|function Orders\b|function Performance\b|function IntegrationSetup\b/);
  assert.doesNotMatch(page, /Instagram|Depop|Shared accounts not connected|LOCAL WORKSPACE/);
});

test("uses Inventory as the complete unsold-item workspace", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /ALL UNSOLD STOCK/);
  assert.match(page, /PHOTO[\s\S]*ITEM[\s\S]*SIZE[\s\S]*CONDITION[\s\S]*COST[\s\S]*EST\. RESALE[\s\S]*SELL STATUS/);
  assert.match(page, /\["Owned","Ready","Published","Sold"\]/);
  assert.match(page, /Marked sold and added to finances/);
});

test("keeps shopping capture-only and decisions inside store review", async () => {
  const [page, css] = await Promise.all([source("app/page.tsx"), source("app/feature-updates.css")]);
  const liveCart = page.slice(page.indexOf('className="cockpit-grid"'), page.indexOf('className="session-finish"'));
  const review = page.slice(page.indexOf('className="review-backdrop"'), page.indexOf('className="capture-sheet"'));

  for (const label of ["Brand", "Description", "Size", "Condition", "Category", "Tag price *", "Resale estimate"]) {
    assert.match(page, new RegExp(`>${label.replace("*", "\\*")}<`));
  }
  assert.doesNotMatch(liveCart, /Bought \/ Keep|Passed \/ Drop|decision-buttons/);
  assert.match(liveCart, /Decide when you finish this store/);
  assert.match(review, />✓ Bought<|>Passed</);
  assert.match(page, /Current store name \*/);
  assert.match(page, /Next store name \*/);
  assert.match(page, /projectedResale:projected,projectedProfit:potential/);
  assert.match(page, /capture="environment"/);
  assert.match(css, /@media\(max-width:760px\)\{input,select,textarea/);
});

test("prepares Supabase shared workspaces without replacing offline storage", async () => {
  const [page, client, server, migration, guide] = await Promise.all([
    source("app/page.tsx"),
    source("lib/supabase/client.ts"),
    source("lib/supabase/server.ts"),
    source("supabase/migrations/202608120001_shared_workspace.sql"),
    source("docs/supabase-shared-workspace.md"),
  ]);

  assert.match(page, /indexedDB\.open\("vigilkline-local"/);
  assert.match(client, /if \(!url \|\| !publishableKey\)[\s\S]*browserClient = null/);
  assert.match(server, /createServerClient/);
  assert.doesNotMatch(server, /SERVICE_ROLE/);
  assert.match(migration, /create type public\.workspace_role as enum \('owner', 'member'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /create or replace function public\.create_workspace/);
  assert.match(migration, /workspace-photos/);
  assert.match(guide, /Do not paste configuration values into chat or commit them/);
});

test("ships the restrained navy industrial visual system", async () => {
  const [css, layout, manifest, favicon] = await Promise.all([
    source("app/globals.css"),
    source("app/layout.tsx"),
    source("public/manifest.webmanifest"),
    source("public/favicon.svg"),
  ]);

  assert.match(css, /--bg:#070d18;--panel:#0d1828;--panel2:#132238/);
  assert.match(css, /VIGILKLINE navy industrial theme/);
  assert.match(css, /body:before[\s\S]*repeating-linear-gradient/);
  assert.match(css, /font-family:var\(--font-geist-mono\),monospace;text-transform:uppercase/);
  assert.match(css, /button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible/);
  assert.match(layout, /theme-color" content="#07101d"/);
  assert.match(manifest, /"background_color": "#07101d"/);
  assert.match(favicon, /fill="#5b91ec"/);
});

test("implements deliberate authenticated shared-workspace onboarding", async () => {
  const [page, shared, adapter, client, guide] = await Promise.all([
    source("app/page.tsx"),
    source("app/shared-workspace.tsx"),
    source("lib/supabase/workspaces.ts"),
    source("lib/supabase/client.ts"),
    source("docs/supabase-shared-workspace.md"),
  ]);

  assert.match(shared, /signInWithOtp/);
  assert.doesNotMatch(shared, /type="password"|signInWithPassword/);
  assert.match(shared, /Open cloud workspace/);
  assert.match(shared, /Copy local records into cloud, then open/);
  assert.match(shared, /device-local workspace is kept intact/);
  assert.match(adapter, /rpc\("create_workspace"/);
  assert.match(adapter, /inventory_items[\s\S]*thrift_sessions[\s\S]*calendar_entries[\s\S]*tax_payments/);
  assert.match(adapter, /workspace-photos/);
  assert.match(page, /dataMode!=="local"/);
  assert.match(client, /if \(!url \|\| !publishableKey\)/);
  assert.match(guide, /Signing in does not change the current data mode/);
});
