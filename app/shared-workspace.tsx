"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import type { WorkspaceSnapshot } from "../lib/workspace-model";
import {
  copyLocalIntoCloud, createWorkspace, emptySnapshot, listWorkspaces, loadWorkspaceSnapshot,
  snapshotCounts, snapshotIsEmpty, syncWorkspaceChanges, type WorkspaceSummary,
} from "../lib/supabase/workspaces";

export type DataMode = "local" | "cloud";
export type CloudCache = { current: WorkspaceSnapshot; baseline: WorkspaceSnapshot };
type Props = {
  localReady: boolean;
  currentSnapshot: WorkspaceSnapshot;
  localSnapshot: WorkspaceSnapshot;
  onHydrate: (snapshot: WorkspaceSnapshot) => void;
  onModeChange: (mode: DataMode, workspaceId?: string) => void;
  loadCache: (workspaceId: string) => Promise<CloudCache | null>;
  saveCache: (workspaceId: string, cache: CloudCache) => Promise<void>;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const activeKey = "vigilkline-active-cloud-workspace";

function rebaseIds(synced: WorkspaceSnapshot, sent: WorkspaceSnapshot, latest: WorkspaceSnapshot): WorkspaceSnapshot {
  const remap = <T extends { id: string | number }>(syncedRows: T[], sentRows: T[], latestRows: T[]) => {
    const ids = new Map(sentRows.map((row, index) => [String(row.id), syncedRows[index]?.id ?? row.id]));
    return latestRows.map(row => ({ ...row, id: ids.get(String(row.id)) ?? row.id }));
  };
  const sessions = remap(synced.sessions, sent.sessions, latest.sessions).map(session => {
    const sentSession = sent.sessions.find(row => String(row.id) === String(session.id)) || sent.sessions.find((_, index) => synced.sessions[index]?.id === session.id);
    const syncedSession = synced.sessions.find(row => row.id === session.id);
    return sentSession && syncedSession ? { ...session, routeId: syncedSession.routeId, candidates: remap(syncedSession.candidates, sentSession.candidates, session.candidates) } : session;
  });
  return {
    ...latest,
    items: remap(synced.items, sent.items, latest.items),
    priorities: remap(synced.priorities, sent.priorities, latest.priorities),
    taxPayments: remap(synced.taxPayments, sent.taxPayments, latest.taxPayments),
    sessions,
  };
}

export function useSharedWorkspace({ localReady, currentSnapshot, localSnapshot, onHydrate, onModeChange, loadCache, saveCache }: Props) {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!client);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [active, setActive] = useState<WorkspaceSummary | null>(null);
  const [pending, setPending] = useState<{ workspace: WorkspaceSummary; snapshot: WorkspaceSnapshot } | null>(null);
  const [mode, setMode] = useState<DataMode>("local");
  const [panelOpen, setPanelOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<"local" | "synced" | "syncing" | "pending" | "offline">("local");
  const baselineRef = useRef<WorkspaceSnapshot>(emptySnapshot());
  const currentRef = useRef(currentSnapshot);
  const serializedRef = useRef(JSON.stringify(currentSnapshot));
  const syncTimerRef = useRef<number | null>(null);
  const resumedRef = useRef<string | null>(null);

  useEffect(() => { currentRef.current = currentSnapshot; }, [currentSnapshot]);

  const hydrateCloud = useCallback((workspace: WorkspaceSummary, snapshot: WorkspaceSnapshot, baseline = snapshot, state: "synced" | "pending" | "offline" = "synced") => {
    baselineRef.current = baseline;
    currentRef.current = snapshot;
    serializedRef.current = JSON.stringify(snapshot);
    setActive(workspace);
    setMode("cloud");
    setSyncState(state);
    onModeChange("cloud", workspace.id);
    onHydrate(snapshot);
    window.localStorage.setItem(activeKey, workspace.id);
    saveCache(workspace.id, { current: snapshot, baseline }).catch(() => {});
  }, [onHydrate, onModeChange, saveCache]);

  const fetchWorkspaces = useCallback(async (signedInUser: User) => {
    if (!client) return [];
    const rows = await listWorkspaces(client, signedInUser);
    setWorkspaces(rows);
    return rows;
  }, [client]);

  const resumeWorkspace = useCallback(async (workspace: WorkspaceSummary, signedInUser: User) => {
    if (!client || resumedRef.current === workspace.id) return;
    resumedRef.current = workspace.id;
    const cached = await loadCache(workspace.id);
    try {
      if (cached && !same(cached.current, cached.baseline)) {
        setSyncState("syncing");
        const saved = await syncWorkspaceChanges(client, workspace.id, signedInUser, cached.baseline, cached.current);
        await saveCache(workspace.id, { current: saved, baseline: saved });
      }
      const remote = await loadWorkspaceSnapshot(client, workspace.id);
      hydrateCloud(workspace, remote);
    } catch {
      if (cached) hydrateCloud(workspace, cached.current, cached.baseline, same(cached.current, cached.baseline) ? "offline" : "pending");
      else { resumedRef.current = null; setMessage("This cloud workspace is unavailable offline until it has been opened once on this device."); }
    }
  }, [client, hydrateCloud, loadCache, saveCache]);

  useEffect(() => {
    if (!client) return;
    let mounted = true;
    client.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const signedInUser = data.session?.user || null;
      setUser(signedInUser);
      setAuthReady(true);
      if (signedInUser) {
        try {
          const rows = await fetchWorkspaces(signedInUser);
          const remembered = rows.find(row => row.id === window.localStorage.getItem(activeKey));
          if (remembered && localReady) await resumeWorkspace(remembered, signedInUser);
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load shared workspaces."); }
      }
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const signedInUser = session?.user || null;
      setUser(signedInUser);
      setAuthReady(true);
      if (signedInUser) fetchWorkspaces(signedInUser).catch(() => setMessage("Could not load shared workspaces."));
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, [client, fetchWorkspaces, localReady, resumeWorkspace]);

  useEffect(() => {
    if (!localReady || !user || mode === "cloud") return;
    const timer = window.setTimeout(() => {
      const rememberedId = window.localStorage.getItem(activeKey);
      const remembered = workspaces.find(workspace => workspace.id === rememberedId);
      if (remembered) resumeWorkspace(remembered, user).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [localReady, mode, resumeWorkspace, user, workspaces]);

  useEffect(() => {
    if (!client || mode !== "cloud" || !active || !user) return;
    const serialized = JSON.stringify(currentSnapshot);
    saveCache(active.id, { current: currentSnapshot, baseline: baselineRef.current }).catch(() => {});
    if (serialized === serializedRef.current) return;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    setSyncState(navigator.onLine ? "syncing" : "pending");
    syncTimerRef.current = window.setTimeout(async () => {
      const sent = currentRef.current;
      try {
        const synced = await syncWorkspaceChanges(client, active.id, user, baselineRef.current, sent);
        baselineRef.current = synced;
        const latest = currentRef.current;
        const rebased = same(latest, sent) ? synced : rebaseIds(synced, sent, latest);
        serializedRef.current = JSON.stringify(rebased);
        currentRef.current = rebased;
        onHydrate(rebased);
        await saveCache(active.id, { current: rebased, baseline: synced });
        setSyncState(same(rebased, synced) ? "synced" : "syncing");
      } catch {
        setSyncState(navigator.onLine ? "pending" : "offline");
      }
    }, 900);
    return () => { if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current); };
  }, [active, client, currentSnapshot, mode, onHydrate, saveCache, user]);

  useEffect(() => {
    if (!client || mode !== "cloud" || !active || syncState !== "synced") return;
    const interval = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || JSON.stringify(currentRef.current) !== serializedRef.current) return;
      try {
        const remote = await loadWorkspaceSnapshot(client, active.id);
        hydrateCloud(active, remote);
      } catch {
        // A missed pull does not interrupt the cached workspace. The next poll
        // or a manual refresh will try again.
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [active, client, hydrateCloud, mode, syncState]);

  const sendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !email.trim()) return;
    setBusy(true); setMessage("");
    const result = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMessage(result.error ? result.error.message : "Check your email for the secure sign-in link. You can close this panel while you wait.");
  };

  const makeWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !user || !workspaceName.trim()) return;
    setBusy(true); setMessage("");
    try {
      const id = await createWorkspace(client, workspaceName);
      const rows = await fetchWorkspaces(user);
      const workspace = rows.find(row => row.id === id);
      setWorkspaceName("");
      if (workspace) setPending({ workspace, snapshot: emptySnapshot() });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the workspace."); }
    setBusy(false);
  };

  const inspectWorkspace = async (workspace: WorkspaceSummary) => {
    if (!client) return;
    setBusy(true); setMessage("");
    try { setPending({ workspace, snapshot: await loadWorkspaceSnapshot(client, workspace.id) }); }
    catch (error) {
      const cached = await loadCache(workspace.id);
      if (cached) setPending({ workspace, snapshot: cached.current });
      else setMessage(error instanceof Error ? error.message : "Could not open this workspace.");
    }
    setBusy(false);
  };

  const activatePending = async (copyLocal: boolean) => {
    if (!client || !user || !pending) return;
    setBusy(true); setMessage("");
    try {
      let snapshot = pending.snapshot;
      if (copyLocal && !snapshotIsEmpty(localSnapshot)) {
        const merged = copyLocalIntoCloud(snapshot, localSnapshot);
        snapshot = await syncWorkspaceChanges(client, pending.workspace.id, user, pending.snapshot, merged);
      }
      hydrateCloud(pending.workspace, snapshot);
      setPending(null); setPanelOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cloud onboarding could not finish."); }
    setBusy(false);
  };

  const refresh = async () => {
    if (!client || !active || !user) return;
    if (syncState === "syncing") { setMessage("A workspace save is already in progress."); return; }
    setBusy(true); setMessage("");
    try {
      if (syncState === "pending" || syncState === "offline") {
        setSyncState("syncing");
        const sent = currentRef.current;
        const synced = await syncWorkspaceChanges(client, active.id, user, baselineRef.current, sent);
        baselineRef.current = synced;
        serializedRef.current = JSON.stringify(synced);
        currentRef.current = synced;
        onHydrate(synced);
        await saveCache(active.id, { current: synced, baseline: synced });
      }
      hydrateCloud(active, await loadWorkspaceSnapshot(client, active.id)); setMessage("Workspace refreshed.");
    }
    catch { setSyncState("offline"); setMessage("Could not reach the cloud. Your cached workspace remains available."); }
    setBusy(false);
  };

  const workLocally = () => {
    if (syncState === "pending" || syncState === "syncing") { setMessage("Sync or retry pending cloud changes before leaving this workspace."); return; }
    window.localStorage.removeItem(activeKey);
    resumedRef.current = null;
    setActive(null); setPending(null); setMode("local"); setSyncState("local");
    serializedRef.current = JSON.stringify(localSnapshot);
    onModeChange("local"); onHydrate(localSnapshot); setPanelOpen(false);
  };

  const signOut = async () => {
    if (!client) return;
    if (mode === "cloud" && (syncState === "pending" || syncState === "syncing")) { setMessage("Retry pending cloud changes before signing out."); return; }
    if (mode === "cloud") workLocally();
    await client.auth.signOut();
    setUser(null); setWorkspaces([]); setPanelOpen(false);
  };

  return {
    configured: Boolean(client), authReady, user, workspaces, active, pending, mode, panelOpen, email, workspaceName,
    message, busy, syncState, localCounts: snapshotCounts(localSnapshot), cloudCounts: pending ? snapshotCounts(pending.snapshot) : null,
    setPanelOpen, setEmail, setWorkspaceName, setPending, sendMagicLink, makeWorkspace, inspectWorkspace, activatePending,
    refresh, workLocally, signOut,
  };
}

export function SharedWorkspaceControl({ controller }: { controller: ReturnType<typeof useSharedWorkspace> }) {
  if (!controller.configured) return null;
  const syncLabel = controller.syncState === "syncing" ? "Syncing" : controller.syncState === "pending" ? "Changes pending" : controller.syncState === "offline" ? "Offline cache" : "Synced";
  return <>
    <button className="workspace-trigger" onClick={() => controller.setPanelOpen(true)} aria-label="Shared workspace settings">
      <span className={controller.syncState}>●</span>
      <b>{controller.active?.name || (controller.user ? "Choose workspace" : "Shared workspace")}</b>
      <small>{controller.active ? `${controller.active.role} · ${syncLabel}` : controller.user?.email || "Secure email sign-in"}</small>
    </button>
    {controller.panelOpen && <div className="workspace-backdrop"><section className="workspace-panel" role="dialog" aria-modal="true" aria-label="Shared workspace">
      <header><div><small>SECURE SHARED WORKSPACE</small><h2>{controller.pending ? controller.pending.workspace.name : controller.active?.name || "VIGILKLINE Cloud"}</h2></div><button onClick={() => { controller.setPanelOpen(false); controller.setPending(null); }}>×</button></header>
      {!controller.authReady ? <p className="workspace-loading">Checking sign-in…</p> : !controller.user ? <>
        <p>Sign in with a secure email link. VIGILKLINE never asks for or stores your email password.</p>
        <form className="workspace-auth" onSubmit={controller.sendMagicLink}><label>Email address<input type="email" required autoComplete="email" value={controller.email} onChange={event => controller.setEmail(event.target.value)} placeholder="you@example.com"/></label><button disabled={controller.busy}>{controller.busy ? "Sending…" : "Email me a sign-in link"}</button></form>
      </> : controller.pending ? <WorkspaceOnboarding controller={controller}/> : <>
        <div className="workspace-account"><span>{controller.user.email}</span><button onClick={controller.signOut}>Sign out</button></div>
        {controller.active && <section className="workspace-current"><small>ACTIVE WORKSPACE</small><b>{controller.active.name}</b><span>{controller.active.role === "owner" ? "Owner — full workspace access" : "Member — shared operational access"}</span><div><button onClick={controller.refresh} disabled={controller.busy}>↻ {controller.syncState === "pending" || controller.syncState === "offline" ? "Retry sync" : "Refresh now"}</button><button onClick={controller.workLocally}>Work locally</button></div></section>}
        <div className="workspace-list"><small>{controller.active ? "SWITCH WORKSPACE" : "YOUR WORKSPACES"}</small>{controller.workspaces.length ? controller.workspaces.map(workspace => <button key={workspace.id} onClick={() => controller.inspectWorkspace(workspace)} disabled={controller.busy || workspace.id === controller.active?.id}><span><b>{workspace.name}</b><small>{workspace.role}</small></span><i>{workspace.id === controller.active?.id ? "Active" : "Open →"}</i></button>) : <p>No shared workspace yet. Create one below.</p>}</div>
        <form className="workspace-create" onSubmit={controller.makeWorkspace}><label>New workspace name<input maxLength={80} required value={controller.workspaceName} onChange={event => controller.setWorkspaceName(event.target.value)} placeholder="e.g. VIGILKLINE Collective"/></label><button disabled={controller.busy}>{controller.busy ? "Creating…" : "Create workspace"}</button></form>
      </>}
      {controller.message && <p className="workspace-message">{controller.message}</p>}
    </section></div>}
  </>;
}

function WorkspaceOnboarding({ controller }: { controller: ReturnType<typeof useSharedWorkspace> }) {
  const local = controller.localCounts, cloud = controller.cloudCounts;
  const localHasData = Object.values(local).some(Boolean);
  return <div className="workspace-onboarding">
    <p>Choose deliberately. Your device-local workspace is kept intact and is never overwritten or deleted by this step.</p>
    <div className="workspace-compare"><div><small>ON THIS DEVICE</small><b>{local.inventory} inventory · {local.sessions} sessions</b><span>{local.calendar} calendar · {local.payments} payments · {local.photos} photos</span></div><div><small>IN THIS CLOUD WORKSPACE</small><b>{cloud?.inventory || 0} inventory · {cloud?.sessions || 0} sessions</b><span>{cloud?.calendar || 0} calendar · {cloud?.payments || 0} payments · {cloud?.photos || 0} photos</span></div></div>
    <button className="workspace-primary" disabled={controller.busy} onClick={() => controller.activatePending(false)}>Open cloud workspace</button>
    <span>Loads cloud records in the app. Local records remain available when you switch back to local mode.</span>
    {localHasData && <><button className="workspace-secondary" disabled={controller.busy} onClick={() => controller.activatePending(true)}>Copy local records into cloud, then open</button><span>Adds new copies to the cloud workspace without replacing existing cloud records. Photos upload to private workspace storage.</span></>}
    <button className="workspace-cancel" onClick={() => controller.setPending(null)}>Back to workspace list</button>
  </div>;
}
