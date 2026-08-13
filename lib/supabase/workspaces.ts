import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { EntityId, Item, SessionCandidate, Status, WorkspaceSnapshot } from "../workspace-model";

export type WorkspaceRole = "owner" | "member";
export type WorkspaceSummary = { id: string; name: string; role: WorkspaceRole; createdAt: string };
export type WorkspaceMember = { userId: string; email: string; role: WorkspaceRole; joinedAt: string };
export type WorkspaceActivity = { id: string; actorEmail: string; action: string; detail: string; createdAt: string };
export type SnapshotCounts = { inventory: number; sessions: number; calendar: number; payments: number; photos: number };

export const emptySnapshot = (): WorkspaceSnapshot => ({ items: [], priorities: [], taxRate: "0", taxPayments: [], sessions: [] });
export const snapshotCounts = (snapshot: WorkspaceSnapshot): SnapshotCounts => ({
  inventory: snapshot.items.length,
  sessions: snapshot.sessions.length,
  calendar: snapshot.priorities.length,
  payments: snapshot.taxPayments.length,
  photos: snapshot.items.filter(item => item.photo).length + snapshot.sessions.flatMap(session => session.candidates).filter(item => item.photo).length,
});
export const snapshotIsEmpty = (snapshot: WorkspaceSnapshot) => Object.values(snapshotCounts(snapshot)).every(value => value === 0) && Number(snapshot.taxRate) === 0;

const isCloudId = (id: EntityId | undefined): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
const statusFromDb = (value: string): Status => value === "ready" ? "Ready" : value === "published" ? "Published" : value === "sold" ? "Sold" : "Owned";
const statusToDb = (value: Status) => value.toLowerCase();
const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);
const localId = (() => { let sequence = 0; return () => Date.now() + sequence++; })();

export async function listWorkspaces(client: SupabaseClient, user: User): Promise<WorkspaceSummary[]> {
  const memberships = await client.from("workspace_members").select("workspace_id, role").eq("user_id", user.id);
  if (memberships.error) throw memberships.error;
  const rows = (memberships.data || []) as { workspace_id: string; role: WorkspaceRole }[];
  if (!rows.length) return [];
  const workspaces = await client.from("workspaces").select("id, name, created_at").in("id", rows.map(row => row.workspace_id));
  if (workspaces.error) throw workspaces.error;
  const roles = new Map(rows.map(row => [row.workspace_id, row.role]));
  return ((workspaces.data || []) as { id: string; name: string; created_at: string }[])
    .map(row => ({ id: row.id, name: row.name, role: roles.get(row.id) || "member", createdAt: row.created_at }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(client: SupabaseClient, name: string): Promise<string> {
  const result = await client.rpc("create_workspace", { workspace_name: name.trim() });
  if (result.error) throw result.error;
  if (typeof result.data !== "string") throw new Error("The workspace could not be created.");
  return result.data;
}

export async function listWorkspaceMembers(client: SupabaseClient, workspaceId: string): Promise<WorkspaceMember[]> {
  const result = await client.rpc("workspace_team", { target_workspace: workspaceId });
  if (result.error) throw result.error;
  return ((result.data || []) as Record<string, unknown>[]).map(row => ({ userId: String(row.user_id), email: String(row.email || "Team member"), role: row.role === "owner" ? "owner" : "member", joinedAt: String(row.joined_at) }));
}

export async function inviteWorkspaceMember(client: SupabaseClient, workspaceId: string, email: string) {
  const result = await client.rpc("invite_workspace_member", { target_workspace: workspaceId, member_email: email.trim() });
  if (result.error) throw result.error;
}

export async function listWorkspaceActivity(client: SupabaseClient, workspaceId: string): Promise<WorkspaceActivity[]> {
  const result = await client.from("workspace_activity").select("id, actor_email, action, detail, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(12);
  if (result.error) throw result.error;
  return ((result.data || []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), actorEmail: String(row.actor_email || "Team member"), action: String(row.action), detail: String(row.detail), createdAt: String(row.created_at) }));
}

async function signedPhotoMap(client: SupabaseClient, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const result = await client.storage.from("workspace-photos").createSignedUrls(unique, 60 * 60);
  if (result.error) throw result.error;
  return new Map<string, string>((result.data || []).filter(row => row.signedUrl && row.path).map(row => [String(row.path), String(row.signedUrl)]));
}

export async function loadWorkspaceSnapshot(client: SupabaseClient, workspaceId: string): Promise<WorkspaceSnapshot> {
  const [inventory, sessions, candidates, calendar, taxSettings, taxPayments] = await Promise.all([
    client.from("inventory_items").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    client.from("thrift_sessions").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }),
    client.from("session_candidates").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    client.from("calendar_entries").select("*").eq("workspace_id", workspaceId).order("entry_date", { ascending: true }),
    client.from("tax_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    client.from("tax_payments").select("*").eq("workspace_id", workspaceId).order("payment_date", { ascending: false }),
  ]);
  for (const result of [inventory, sessions, candidates, calendar, taxSettings, taxPayments]) if (result.error) throw result.error;

  const inventoryRows = (inventory.data || []) as Record<string, unknown>[];
  const candidateRows = (candidates.data || []) as Record<string, unknown>[];
  const paths = [...inventoryRows, ...candidateRows].map(row => String(row.photo_path || "")).filter(Boolean);
  const photos = await signedPhotoMap(client, paths);
  const mappedCandidates = new Map<string, SessionCandidate[]>();
  for (const row of candidateRows) {
    const sessionId = String(row.session_id);
    const photoPath = row.photo_path ? String(row.photo_path) : undefined;
    const candidate: SessionCandidate = {
      id: String(row.id), brand: String(row.brand || ""), description: String(row.description || ""),
      size: row.size ? String(row.size) : undefined, condition: row.condition ? String(row.condition) : undefined,
      category: row.category ? String(row.category) : undefined, cost: Number(row.tag_price || 0), price: 0,
      estimatedResale: row.estimated_resale == null ? undefined : Number(row.estimated_resale),
      decision: row.decision === "passed" ? "passed" : "bought", photoPath, photo: photoPath ? photos.get(photoPath) : undefined,
    };
    mappedCandidates.set(sessionId, [...(mappedCandidates.get(sessionId) || []), candidate]);
  }

  return {
    items: inventoryRows.map(row => {
      const photoPath = row.photo_path ? String(row.photo_path) : undefined;
      return {
        id: String(row.id), brand: String(row.brand || ""), description: String(row.description || ""),
        size: row.size ? String(row.size) : undefined, condition: row.condition ? String(row.condition) : undefined,
        category: row.category ? String(row.category) : undefined, cost: Number(row.cost || 0), price: Number(row.sale_price || 0),
        estimatedResale: row.estimated_resale == null ? undefined : Number(row.estimated_resale), status: statusFromDb(String(row.status)),
        photoPath, photo: photoPath ? photos.get(photoPath) : undefined,
      } as Item;
    }),
    priorities: ((calendar.data || []) as Record<string, unknown>[]).map(row => ({
      id: String(row.id), text: String(row.title || ""), date: String(row.entry_date),
      time: row.entry_time ? String(row.entry_time).slice(0, 5) : undefined, category: row.category ? String(row.category) : undefined,
      done: Boolean(row.completed),
    })),
    taxRate: String((taxSettings.data as Record<string, unknown> | null)?.tax_rate ?? "0"),
    taxPayments: ((taxPayments.data || []) as Record<string, unknown>[]).map(row => ({ id: String(row.id), amount: Number(row.amount), date: String(row.payment_date) })),
    sessions: ((sessions.data || []) as Record<string, unknown>[]).map(row => ({
      id: String(row.id), routeId: String(row.route_id), date: String(row.started_at).slice(0, 10),
      startedAt: Date.parse(String(row.started_at)), endedAt: Date.parse(String(row.ended_at)), location: String(row.store_name),
      budget: Number(row.budget || 0), spend: Number(row.spend || 0), projectedResale: Number(row.projected_resale || 0),
      projectedProfit: Number(row.projected_profit || 0), phaseTimes: {
        driving: Number(row.driving_seconds || 0), parking: Number(row.parking_seconds || 0), store: Number(row.store_seconds || 0),
      }, candidates: mappedCandidates.get(String(row.id)) || [],
    })),
  };
}

async function uploadPhoto(client: SupabaseClient, workspaceId: string, kind: "inventory" | "candidate", id: string, photo?: string) {
  if (!photo?.startsWith("data:")) return undefined;
  const blob = await fetch(photo).then(response => response.blob());
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${workspaceId}/${kind}/${id}.${extension}`;
  const result = await client.storage.from("workspace-photos").upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (result.error) throw result.error;
  return path;
}

async function deleteIds(client: SupabaseClient, table: string, workspaceId: string, ids: string[]) {
  if (!ids.length) return;
  const result = await client.from(table).delete().eq("workspace_id", workspaceId).in("id", ids);
  if (result.error) throw result.error;
}

export async function syncWorkspaceChanges(client: SupabaseClient, workspaceId: string, user: User, before: WorkspaceSnapshot, after: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const next: WorkspaceSnapshot = structuredClone(after);
  const previousItemIds = new Set(before.items.filter(item => isCloudId(item.id)).map(item => String(item.id)));
  await deleteIds(client, "inventory_items", workspaceId, [...previousItemIds].filter(id => !after.items.some(item => String(item.id) === id)));
  for (let index = 0; index < next.items.length; index++) {
    const item = next.items[index];
    const previous = before.items.find(row => String(row.id) === String(item.id));
    if (previous && !changed(previous, item)) continue;
    const values = { workspace_id: workspaceId, brand: item.brand, description: item.description, size: item.size || null, condition: item.condition || null, category: item.category || null, cost: item.cost, sale_price: item.price, estimated_resale: item.estimatedResale ?? null, status: statusToDb(item.status), updated_at: new Date().toISOString() };
    const result = isCloudId(item.id)
      ? await client.from("inventory_items").update(values).eq("workspace_id", workspaceId).eq("id", item.id).select("id").single()
      : await client.from("inventory_items").insert({ ...values, created_by: user.id }).select("id").single();
    if (result.error) throw result.error;
    const id = String(result.data.id);
    const photoPath = await uploadPhoto(client, workspaceId, "inventory", id, item.photo);
    if (photoPath) {
      const photoUpdate = await client.from("inventory_items").update({ photo_path: photoPath }).eq("id", id);
      if (photoUpdate.error) throw photoUpdate.error;
    }
    next.items[index] = { ...item, id, photoPath: photoPath || item.photoPath };
  }

  const previousSessionIds = new Set(before.sessions.filter(session => isCloudId(session.id)).map(session => String(session.id)));
  await deleteIds(client, "thrift_sessions", workspaceId, [...previousSessionIds].filter(id => !after.sessions.some(session => String(session.id) === id)));
  const routeIds = new Map<string, string>();
  for (let sessionIndex = 0; sessionIndex < next.sessions.length; sessionIndex++) {
    let session = next.sessions[sessionIndex];
    const oldSession = before.sessions.find(row => String(row.id) === String(session.id));
    let routeId = isCloudId(session.routeId) ? session.routeId : routeIds.get(String(session.routeId));
    if (!routeId) { routeId = crypto.randomUUID(); routeIds.set(String(session.routeId), routeId); }
    const sessionValues = { workspace_id: workspaceId, route_id: routeId, store_name: session.location, started_at: new Date(session.startedAt).toISOString(), ended_at: new Date(session.endedAt).toISOString(), budget: session.budget, spend: session.spend, projected_resale: session.projectedResale || 0, projected_profit: session.projectedProfit || 0, driving_seconds: session.phaseTimes.driving, parking_seconds: session.phaseTimes.parking, store_seconds: session.phaseTimes.store, updated_at: new Date().toISOString() };
    if (!oldSession || changed({ ...oldSession, candidates: [] }, { ...session, candidates: [], routeId: oldSession.routeId })) {
      const result = isCloudId(session.id)
        ? await client.from("thrift_sessions").update(sessionValues).eq("workspace_id", workspaceId).eq("id", session.id).select("id").single()
        : await client.from("thrift_sessions").insert({ ...sessionValues, created_by: user.id }).select("id").single();
      if (result.error) throw result.error;
      session = { ...session, id: String(result.data.id), routeId };
    }
    const oldCandidates = oldSession?.candidates || [];
    const oldCandidateIds = oldCandidates.filter(candidate => isCloudId(candidate.id)).map(candidate => String(candidate.id));
    await deleteIds(client, "session_candidates", workspaceId, oldCandidateIds.filter(id => !session.candidates.some(candidate => String(candidate.id) === id)));
    const candidates: SessionCandidate[] = [];
    for (const candidate of session.candidates) {
      const oldCandidate = oldCandidates.find(row => String(row.id) === String(candidate.id));
      if (oldCandidate && !changed(oldCandidate, candidate)) { candidates.push(candidate); continue; }
      const values = { workspace_id: workspaceId, session_id: String(session.id), brand: candidate.brand, description: candidate.description, size: candidate.size || null, condition: candidate.condition || null, category: candidate.category || null, tag_price: candidate.cost, estimated_resale: candidate.estimatedResale ?? null, decision: candidate.decision === "passed" ? "passed" : "bought" };
      const result = isCloudId(candidate.id)
        ? await client.from("session_candidates").update(values).eq("workspace_id", workspaceId).eq("id", candidate.id).select("id").single()
        : await client.from("session_candidates").insert(values).select("id").single();
      if (result.error) throw result.error;
      const id = String(result.data.id);
      const photoPath = await uploadPhoto(client, workspaceId, "candidate", id, candidate.photo);
      if (photoPath) {
        const photoUpdate = await client.from("session_candidates").update({ photo_path: photoPath }).eq("id", id);
        if (photoUpdate.error) throw photoUpdate.error;
      }
      candidates.push({ ...candidate, id, photoPath: photoPath || candidate.photoPath });
    }
    next.sessions[sessionIndex] = { ...session, candidates };
  }

  const previousPriorityIds = new Set(before.priorities.filter(entry => isCloudId(entry.id)).map(entry => String(entry.id)));
  await deleteIds(client, "calendar_entries", workspaceId, [...previousPriorityIds].filter(id => !after.priorities.some(entry => String(entry.id) === id)));
  for (let index = 0; index < next.priorities.length; index++) {
    const entry = next.priorities[index];
    const previous = before.priorities.find(row => String(row.id) === String(entry.id));
    if (previous && !changed(previous, entry)) continue;
    const values = { workspace_id: workspaceId, title: entry.text, entry_date: entry.date || new Date().toISOString().slice(0, 10), entry_time: entry.time || null, category: entry.category || null, completed: entry.done, updated_at: new Date().toISOString() };
    const result = isCloudId(entry.id)
      ? await client.from("calendar_entries").update(values).eq("workspace_id", workspaceId).eq("id", entry.id).select("id").single()
      : await client.from("calendar_entries").insert({ ...values, created_by: user.id }).select("id").single();
    if (result.error) throw result.error;
    next.priorities[index] = { ...entry, id: String(result.data.id) };
  }

  if (before.taxRate !== after.taxRate) {
    const result = await client.from("tax_settings").upsert({ workspace_id: workspaceId, tax_rate: Number(after.taxRate) || 0, updated_by: user.id, updated_at: new Date().toISOString() });
    if (result.error) throw result.error;
  }
  const previousPaymentIds = new Set(before.taxPayments.filter(payment => isCloudId(payment.id)).map(payment => String(payment.id)));
  await deleteIds(client, "tax_payments", workspaceId, [...previousPaymentIds].filter(id => !after.taxPayments.some(payment => String(payment.id) === id)));
  for (let index = 0; index < next.taxPayments.length; index++) {
    const payment = next.taxPayments[index];
    const previous = before.taxPayments.find(row => String(row.id) === String(payment.id));
    if (previous && !changed(previous, payment)) continue;
    const values = { workspace_id: workspaceId, amount: payment.amount, payment_date: payment.date };
    const result = isCloudId(payment.id)
      ? await client.from("tax_payments").update(values).eq("workspace_id", workspaceId).eq("id", payment.id).select("id").single()
      : await client.from("tax_payments").insert({ ...values, created_by: user.id }).select("id").single();
    if (result.error) throw result.error;
    next.taxPayments[index] = { ...payment, id: String(result.data.id) };
  }
  return next;
}

export function copyLocalIntoCloud(cloud: WorkspaceSnapshot, local: WorkspaceSnapshot): WorkspaceSnapshot {
  const copyItem = (item: Item): Item => ({ ...item, id: localId(), photoPath: undefined });
  const copyCandidate = (candidate: SessionCandidate): SessionCandidate => ({ ...candidate, id: localId(), photoPath: undefined });
  const copiedSessions = local.sessions.map(session => ({ ...session, id: localId(), routeId: localId(), candidates: session.candidates.map(copyCandidate) }));
  return {
    items: [...local.items.map(copyItem), ...cloud.items],
    priorities: [...local.priorities.map(entry => ({ ...entry, id: localId() })), ...cloud.priorities],
    taxRate: Number(cloud.taxRate) ? cloud.taxRate : local.taxRate,
    taxPayments: [...local.taxPayments.map(payment => ({ ...payment, id: localId() })), ...cloud.taxPayments],
    sessions: [...copiedSessions, ...cloud.sessions],
  };
}
