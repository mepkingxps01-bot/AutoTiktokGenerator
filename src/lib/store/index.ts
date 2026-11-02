import { getConfig } from "../config";
import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";

const globalForStore = globalThis as unknown as { __drtraderStore?: Store; __drtraderStoreOverride?: Store };

export function getStore(): Store {
  if (globalForStore.__drtraderStoreOverride) return globalForStore.__drtraderStoreOverride;
  if (globalForStore.__drtraderStore) return globalForStore.__drtraderStore;
  const cfg = getConfig();
  globalForStore.__drtraderStore =
    cfg.storeKind === "supabase"
      ? new SupabaseStore(cfg.supabase.url!, cfg.supabase.serviceRoleKey!, cfg.supabase.bucket)
      : new LocalStore(cfg.localDataDir);
  return globalForStore.__drtraderStore;
}

/** Tests inject an isolated store. */
export function setStoreForTests(store: Store | undefined) {
  globalForStore.__drtraderStoreOverride = store;
}

export type { Store } from "./types";
