import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createClient as createCookieClient } from "./server";
import type { Role } from "@/lib/types";

export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireSameOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AuthError(403, "This request must come from the HRMS workspace.");
  }
}

export async function requireAppRole(request: NextRequest, allowed: Role[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AuthError(503, "Supabase is not configured.");

  const bearer = request.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined;
  const supabase = token
    ? createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
    : await createCookieClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new AuthError(401, "Sign in is required.");
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("user_id,role,employee_id,full_name,department")
    .eq("user_id", user.id).single();
  if (profileError || !profile) throw new AuthError(403, "Your account has no HRMS profile.");
  if (!allowed.includes(profile.role as Role)) throw new AuthError(403, "Your role cannot access this action.");
  return { supabase, user, profile };
}
