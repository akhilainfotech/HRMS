"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import "../location.css";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your password reset link…");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepareRecovery() {
      const client = createClient();
      const code = new URL(window.location.href).searchParams.get("code");
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
          if (active) { setMessage("This reset link is invalid or expired. Request a new one from sign-in."); setReady(false); }
          return;
        }
      }
      const { data: { session }, error } = await client.auth.getSession();
      if (!active) return;
      if (error || !session) { setMessage("This reset link is invalid or expired. Request a new one from sign-in."); setReady(false); return; }
      setMessage("Choose a new password with at least 12 characters.");
      setReady(true);
    }
    void prepareRecovery().catch(() => { if (active) { setMessage("Could not validate this reset link. Request a new one from sign-in."); setReady(false); } });
    return () => { active = false; };
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 12) { setMessage("Use at least 12 characters."); return; }
    if (password !== confirmation) { setMessage("The passwords do not match."); return; }
    setBusy(true);
    try {
      const client = createClient();
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
    {complete && <a className="recovery-link" href="/">Back to sign in</a>}
  </form></main>;
}
