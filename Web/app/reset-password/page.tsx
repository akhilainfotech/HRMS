"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import "../location.css";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your password reset link…");
  const [complete, setComplete] = useState(false);
  const recovery = useRef<Promise<ReturnType<typeof createClient>> | null>(null);

  useEffect(() => {
    let active = true;
    async function prepareRecovery() {
      recovery.current ??= (async () => {
        const { searchParams } = new URL(window.location.href);
        const code = searchParams.get("code");
        const tokenHash = searchParams.get("token_hash");
        if (!code && !(tokenHash && searchParams.get("type") === "recovery")) {
          throw new Error("Recovery link missing");
        }
        const client = createClient(false);
        const { data, error } = code
          ? await client.auth.exchangeCodeForSession(code)
          : await client.auth.verifyOtp({ token_hash: tokenHash!, type: "recovery" });
        if (error || !data.session) throw error ?? new Error("Recovery session missing");
        window.history.replaceState(null, "", window.location.pathname);
        return client;
      })();
      await recovery.current;
      if (!active) return;
      setMessage("Choose a new password with at least 12 characters.");
      setReady(true);
    }
    void prepareRecovery().catch(() => { if (active) { setMessage("This reset link could not be verified. Request a new one and open it in the same browser."); setReady(false); } });
    return () => { active = false; };
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || complete || !recovery.current) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 12) { setMessage("Use at least 12 characters."); return; }
    if (password !== confirmation) { setMessage("The passwords do not match."); return; }
    setBusy(true);
    try {
      const client = await recovery.current;
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await client.auth.signOut();
      setComplete(true);
      setMessage("Password updated. Return to the HRMS sign-in page and sign in with your new password.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the password. Request a new reset link."); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell"><form className="auth-card" onSubmit={(event) => void savePassword(event)}>
    <span className="brand-mark">H</span><p className="eyebrow">HRMS SECURE ACCESS</p>
    <h1>{complete ? "Password updated" : "Set a new password"}</h1>
    <p>{message}</p>
    {ready && !complete && <>
      <label>New password<input required minLength={12} name="password" type="password" autoComplete="new-password"/></label>
      <label>Confirm new password<input required minLength={12} name="confirmation" type="password" autoComplete="new-password"/></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? "Updating…" : "Save new password"}</button>
    </>}
    <a className="recovery-link" href="/">Back to sign in</a>
  </form></main>;
}
