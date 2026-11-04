import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let cached: SupabaseClient | undefined;
export function getSupabase() {
  if (cached) return cached;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Set Mobile/.env.local from Mobile/.env.example.");
  cached = createClient(url, key, {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  return cached;
}

export const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:3000";
