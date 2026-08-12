import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("uses Inventory as the single unsold-item workspace", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /type View = [^;]*"inventory"[^;]*"performance"/);
  assert.doesNotMatch(page, /id:\s*"listings"/i);
  assert.doesNotMatch(page, /function Listings\b/);
  assert.match(page, /ALL UNSOLD STOCK/);
  assert.match(page, /PHOTO[\s\S]*ITEM[\s\S]*SIZE[\s\S]*CONDITION[\s\S]*COST[\s\S]*EST\. RESALE[\s\S]*SELL STATUS/);
  assert.match(page, /\["Owned","Ready","Published","Sold"\]/);
  assert.match(page, /Instagram[\s\S]*Not connected · manual status only/);
  assert.match(page, /Depop[\s\S]*Not connected · manual status only/);
});

test("retains complete store segments and separate candidate fields", async () => {
  const page = await source("app/page.tsx");

  for (const label of ["Brand", "Description", "Size", "Condition", "Category", "Tag price *", "Resale estimate"]) {
    assert.match(page, new RegExp(`>${label.replace("*", "\\*")}<`));
  }
  assert.match(page, /Current store name \*/);
  assert.match(page, /Next store name \*/);
  assert.match(page, /projectedResale:projected,projectedProfit:potential/);
  assert.match(page, /Compare store performance/);
  assert.match(page, /DECISIONS[\s\S]*TIME[\s\S]*SPEND[\s\S]*EST\. RESALE[\s\S]*POTENTIAL/);
  assert.match(page, /Passed items remain in this store segment/);
  assert.match(page, /write\("active-session"/);
  assert.match(page, /capture="environment"/);
});

test("keeps external performance honest and documents secure sync", async () => {
  const [page, architecture] = await Promise.all([
    source("app/page.tsx"),
    source("docs/integrations-architecture.md"),
  ]);

  assert.match(page, /function Performance\b/);
  assert.match(page, /Local sales are ready\. External channels are not connected\./);
  assert.match(page, /No sample metrics are shown\./);
  assert.match(page, /0 OF 2 CONNECTED/);
  assert.match(page, /No password entry · no scraping/);
  assert.match(page, /Needs real synced data/);
  assert.match(architecture, /OAuth authorization code flow and PKCE/);
  assert.match(architecture, /encrypted server-side storage/);
  assert.match(architecture, /Conversion must remain unavailable/);
  assert.match(architecture, /Never scrape platform pages/);
});
