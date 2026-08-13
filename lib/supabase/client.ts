import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

declare global {
  interface Window {
    __VIGILKLINE_SUPABASE__?: { url?: string; publishableKey?: string };
  }
}

/**
 * Returns null until the user has created a Supabase project and configured
 * its public URL and publishable key. The existing IndexedDB workspace remains
 * the active offline data source while cloud sync is not configured.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;

  // Vercel supplies these public values at build time. The small runtime
  // fallback lets an already-built client pick them up from the document too,
  // which prevents a stale PWA bundle from hiding the shared-workspace entry.
  const runtime = typeof window === "undefined" ? undefined : window.__VIGILKLINE_SUPABASE__;
  const url = runtime?.url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = runtime?.publishableKey || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
