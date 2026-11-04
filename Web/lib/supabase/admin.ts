import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Server-only Supabase secret key is not configured.");
  return createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}
