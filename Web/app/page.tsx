"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import "./location.css";
import type { DashboardData, Role } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const empty: DashboardData = {
  permissions: { hr_add_employee: true, hr_geotag_monitor: true, hr_od_approvals: true, hr_monthly_download: true },
  office: { name: "", lat: 0, lng: 0, allowedRadiusMeters: 250 }, attendance: [], requests: [], employees: [], hrUsers: [],
};
const labels: Record<string, string> = {
  hr_add_employee: "Employee onboarding", hr_geotag_monitor: "Attendance monitor",
  hr_od_approvals: "On-duty approvals", hr_monthly_download: "Monthly CSV export",
};

export default function Home() {
  const [role, setRole] = useState<Role | null>(null);
  const [data, setData] = useState<DashboardData>(empty);
  const [message, setMessage] = useState("");
  const [employee, setEmployee] = useState({ id: "", name: "", department: "", designation: "", email: "" });
  const [hrUser, setHrUser] = useState({ id: "HR001", name: "", department: "", email: "" });
  const [employeePhoto, setEmployeePhoto] = useState<File | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [employeeBusy, setEmployeeBusy] = useState(false);
  const [employeeFeedback, setEmployeeFeedback] = useState<{ kind: "working" | "success" | "error"; text: string } | null>(null);
  const [hrCreateBusy, setHrCreateBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const [office, setOffice] = useState(empty.office);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMessage, setGeoMessage] = useState("");
  const [savedOfficeName, setSavedOfficeName] = useState<string | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const current = await response.json();
    if (!response.ok) { setRole(null); if (response.status !== 401) setMessage(current.error ?? "Could not load HRMS data."); return; }
    if (current.role === "EMPLOYEE") { setRole(null); setMessage("Employee sign-in belongs in the mobile app."); return; }
    setData(current); setOffice(current.office); setRole(current.role);
  }
  useEffect(() => { void refresh(); }, []);
  const permittedTabs = useMemo(() => [
    ["overview", "Overview", true], ["attendance", "Attendance", data.permissions.hr_geotag_monitor],
    ["requests", "On-duty requests", data.permissions.hr_od_approvals], ["employees", "Employees", data.permissions.hr_add_employee],
    ["reports", "Monthly report", data.permissions.hr_monthly_download], ["hrUsers", "HR accounts", role === "ADMIN"],
  ].filter(([, , enabled]) => role === "ADMIN" || enabled) as [string, string, boolean][], [data.permissions, role]);

  async function mutate(payload: object, savedMessage = "Saved") {
    setMessage("");
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "Could not save changes"); return false; }
      setData(result); setOffice(result.office); setMessage(savedMessage);
      return true;
    } catch {
      setMessage("Could not reach the HRMS server. Check the connection and try again.");
      return false;
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    try {
      const { error } = await createClient().auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
      if (error) throw error;
      setLoginPassword("");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign-in failed."); }
  }

  async function requestPasswordRecovery() {
    const workEmail = loginEmail.trim().toLowerCase();
    if (!workEmail) { setMessage("Enter your work email first."); return; }
    setRecoveryBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(workEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setMessage("If that account exists, a password reset link was sent to its work email.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send the reset email. Try again."); }
    finally { setRecoveryBusy(false); }
  }

  async function signOut() {
    await createClient().auth.signOut(); setRole(null); setData(empty); setTab("overview"); setMessage("Signed out.");
  }

  async function changeMyPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) { setMessage("Use at least 12 characters for your new password."); return; }
    if (newPassword !== confirmPassword) { setMessage("The passwords do not match."); return; }
    setPasswordBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(""); setConfirmPassword(""); setSecurityOpen(false);
      setMessage("Your password has been changed. Your current session remains signed in.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Password change failed."); }
    finally { setPasswordBusy(false); }
  }

  async function resetEmployeePassword(employeeId: string) {
    if (!window.confirm(`Reset the sign-in password for ${employeeId}? The current password will stop working.`)) return;
    setMessage(`Resetting password for ${employeeId}…`);
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/reset-password`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Password reset failed.");
      setMessage(`Temporary password for ${employeeId} (shown once; share securely): ${result.temporaryPassword}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Password reset failed."); }
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!employeePhoto) { setEmployeeFeedback({ kind: "error", text: "Choose the employee’s face photo first." }); return; }
    setEmployeeBusy(true);
    setEmployeeFeedback({ kind: "working", text: "Saving employee details, enrolling the photo, and linking the sign-in…" });
    try {
      const form = new FormData();
      form.append("employeeId", employee.id); form.append("fullName", employee.name); form.append("department", employee.department);
      form.append("designation", employee.designation); form.append("workEmail", employee.email); form.append("faceConsent", String(faceConsent)); form.append("photo", employeePhoto);
      const response = await fetch("/api/employees", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) { setEmployeeFeedback({ kind: "error", text: result.error ?? "Employee setup failed. The employee was not added." }); return; }
      setEmployeeFeedback({ kind: "success", text: result.initialPassword
        ? `Employee ${result.employeeId} added and linked to the HRMS profile. No email was sent. Initial sign-in password (copy it now): ${result.initialPassword}`
        : `Employee ${result.employeeId} added and linked to the existing employee sign-in. No email was sent; they should use their current password.` });
      setEmployee({ id: "", name: "", department: "", designation: "", email: "" }); setEmployeePhoto(null); setFaceConsent(false);
      await refresh();
    } catch {
      setEmployeeFeedback({ kind: "error", text: "Could not complete employee setup. Check the connection, then retry; the form details are still here." });
    } finally {
      setEmployeeBusy(false);
    }
  }

  async function addHrUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    setHrCreateBusy(true);
    try {
      const response = await fetch("/api/hr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hrId: hrUser.id, fullName: hrUser.name, department: hrUser.department, workEmail: hrUser.email }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "HR account could not be created."); return; }
      setMessage(`HR account ${result.hrId} created and linked to the HRMS profile. No email was sent. Initial sign-in password (copy it now): ${result.initialPassword}`);
      setHrUser({ id: "", name: "", department: "", email: "" });
      await refresh();
    } catch {
      setMessage("Could not reach the HRMS server. Check the connection and try again.");
    } finally {
      setHrCreateBusy(false);
    }
  }

  async function saveOffice(candidate: DashboardData["office"]) {
    setGeoBusy(true);
    setSavedOfficeName(null);
    setGeoMessage("Saving office geofence…");
    try {
      const saved = await mutate({ action: "office", office: candidate }, "Office geofence saved.");
      setGeoMessage(saved ? "Office geofence saved." : "Could not confirm the save. Check the dashboard message and retry.");
      if (saved) setSavedOfficeName(candidate.name.trim());
    } finally {
      setGeoBusy(false);
    }
  }

  function useCurrentLocation() {
    if (!office.name.trim()) { setGeoMessage("Enter the office name before capturing its location."); return; }
    if (!navigator.geolocation) { setGeoMessage("This browser does not provide geolocation."); return; }
    setGeoBusy(true); setGeoMessage("Improving GPS accuracy. Keep this page open near the office…");
    let bestFix: GeolocationPosition | null = null;
    let finished = false;
    let watchId: number | undefined;
    let deadline: number | undefined;

    const stop = () => {
      if (finished) return;
      finished = true;
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      if (deadline !== undefined) window.clearTimeout(deadline);
      setGeoBusy(false);
    };
    const acceptFix = (fix: GeolocationPosition) => {
      const accuracyMeters = fix.coords.accuracy;
      if (!Number.isFinite(accuracyMeters) || accuracyMeters > 50) {
        stop();
        setGeoMessage(`GPS accuracy is ±${Math.ceil(accuracyMeters)} m, too imprecise to set the office. Use a phone with GPS near the office or enter coordinates verified by your facilities team.`);
        return;
      }
      const updatedOffice = { ...office, lat: fix.coords.latitude, lng: fix.coords.longitude, accuracyMeters, capturedAt: new Date(fix.timestamp).toISOString() };
      setOffice(updatedOffice);
      stop();
      void saveOffice(updatedOffice);
    };

    watchId = navigator.geolocation.watchPosition(
      (fix) => {
        if (finished) return;
        if (!bestFix || fix.coords.accuracy < bestFix.coords.accuracy) bestFix = fix;
        if (fix.coords.accuracy >= 0 && fix.coords.accuracy <= 50) { acceptFix(fix); return; }
        setGeoMessage(`Improving GPS accuracy… best fix so far is ±${Math.ceil(bestFix.coords.accuracy)} m; the office pin has not been changed yet.`);
      },
      (error) => {
        if (finished) return;
        stop();
        setGeoMessage(error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. Allow precise location in the browser and try again."
          : "Could not get a GPS fix. Try on an Android phone outdoors or enter verified coordinates manually.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    deadline = window.setTimeout(() => {
      if (finished) return;
      if (bestFix && bestFix.coords.accuracy <= 50) acceptFix(bestFix);
      else {
        const accuracy = bestFix ? Math.ceil(bestFix.coords.accuracy) : null;
        stop();
        setGeoMessage(accuracy === null
          ? "No GPS fix arrived. Allow precise location, enable device location services, and retry near the office."
          : `GPS accuracy is ±${accuracy} m, too imprecise to set the office. Use a phone with GPS near the office or enter coordinates verified by your facilities team.`);
      }
    }, 15000);
  }

  function exportCsv() {
    const rows = [["Employee ID", "Name", "Date", "Time", "Mode", "Location"], ...data.attendance.map((r) => [r.employeeId, r.employeeName, new Date(r.occurredAt).toLocaleDateString(), new Date(r.occurredAt).toLocaleTimeString(), r.mode, r.locationLabel])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "attendance-present.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  if (!role) return <main className="auth-shell"><form className="auth-card" onSubmit={(event) => void signIn(event)}>
    <span className="brand-mark">H</span><p className="eyebrow">HRMS SECURE ACCESS</p><h1>Admin and HR sign in</h1><p>Use the account created by your HRMS administrator.</p>
    {message && <p className="auth-error">{message}</p>}
    <label>Work email<input required type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)}/></label>
    <label>Password<input required type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)}/></label>
    <button className="primary" type="submit">Sign in</button>
    <button className="recovery-link" type="button" onClick={() => void requestPasswordRecovery()} disabled={recoveryBusy}>{recoveryBusy ? "Sending reset link…" : "Forgot password?"}</button>
  </form></main>;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">H</span><div><strong>PeopleOps</strong><small>ATTENDANCE</small></div></div>
      <p className="nav-label">WORKSPACE</p>{permittedTabs.map(([id, label]) => <button className={`nav-item ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id)}>{label}</button>)}
      <div className="sidebar-bottom"><span className="dot"/>Authenticated workspace</div>
    </aside>
    <section className="main-area"><header className="topbar"><div><span className="eyebrow">HRMS / {role}</span><h1>{role === "ADMIN" ? "Admin console" : "HR workspace"}</h1></div><div className="account-actions"><button className="secondary-button" onClick={() => setSecurityOpen((open) => !open)}>{securityOpen ? "Close password settings" : "Change my password"}</button><button className="signout-button" onClick={() => void signOut()}>Sign out</button></div></header>
      {securityOpen && <form className="card password-card" onSubmit={(event) => void changeMyPassword(event)}><div><h3>Change your password</h3><p>Only you can change your password. Admins cannot view it.</p></div><div className="form-grid"><label>New password<input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)}/></label><label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label><button className="primary wide" type="submit" disabled={passwordBusy}>{passwordBusy ? "Updating…" : "Update my password"}</button></div></form>}
      {message && <p className="notice">{message}</p>}
      {role === "ADMIN" && tab === "overview" && <><div className="welcome"><div><p className="eyebrow">ADMINISTRATION</p><h2>Attendance control center</h2><p>Configure the office geofence and choose which tools HR can access.</p></div><span className="welcome-icon">⌖</span></div>
        <div className="stats"><Stat label="Employees" value={data.employees.length}/><Stat label="Present today" value={data.attendance.filter((r) => new Date(r.occurredAt).toDateString() === new Date().toDateString()).length}/><Stat label="Pending requests" value={data.requests.filter((r) => r.status === "PENDING").length}/></div>
        <div className="columns"><section className="card"><div className="card-head"><div><h3>HR access</h3><p>Choose which HR workspace sections are available.</p></div><span className="tag">ROLE SETTINGS</span></div><div className="permission-list">{Object.entries(data.permissions).map(([key, value]) => <label className="permission" key={key}><span><strong>{labels[key]}</strong><small>HR access to this module</small></span><input type="checkbox" checked={value} onChange={(e) => void mutate({ action: "permissions", permissions: { ...data.permissions, [key]: e.target.checked } })}/></label>)}</div></section>
        <section className="card"><div className="card-head"><div><h3>Office geofence</h3><p>Capture and save a precise office location, or enter verified coordinates.</p></div><span className="tag green">LOCATION</span></div>
          <button className="secondary-button wide" type="button" disabled={geoBusy} onClick={useCurrentLocation}>Capture and save current location</button>
          {geoMessage && <p className="geo-message" role={savedOfficeName ? undefined : "status"}>{geoMessage}</p>}
          {savedOfficeName && <aside className="office-save-toast">
            <div role="status">
              <strong>Office geofence saved</strong>
              <p>The attendance location for {savedOfficeName} is saved.</p>
            </div>
            <button className="signout-button" type="button" onClick={() => setSavedOfficeName(null)}>Dismiss</button>
          </aside>}
          {office.accuracyMeters !== undefined && <p className="geo-message">Last GPS fix: ±{office.accuracyMeters} m accuracy{office.capturedAt ? ` · ${new Date(office.capturedAt).toLocaleString()}` : ""}</p>}
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (geoBusy) return; if (office.lat === 0 && office.lng === 0) { setMessage("The office coordinates are still 0, 0. Capture the actual office location or enter its verified coordinates before saving."); return; } void saveOffice(office); }}><label className="wide">Office name<input required disabled={geoBusy} value={office.name} onChange={(e) => setOffice({ ...office, name: e.target.value })}/></label><label>Latitude<input required type="number" min="-90" max="90" step="any" disabled={geoBusy} value={office.lat} onChange={(e) => setOffice({ ...office, lat: Number(e.target.value), accuracyMeters: undefined, capturedAt: undefined })}/></label><label>Longitude<input required type="number" min="-180" max="180" step="any" disabled={geoBusy} value={office.lng} onChange={(e) => setOffice({ ...office, lng: Number(e.target.value), accuracyMeters: undefined, capturedAt: undefined })}/></label><label className="wide">Radius in meters<input required min="25" max="5000" type="number" disabled={geoBusy} value={office.allowedRadiusMeters} onChange={(e) => setOffice({ ...office, allowedRadiusMeters: Number(e.target.value) })}/></label><button className="primary wide" type="submit" disabled={geoBusy}>Save geofence</button></form>
          {office.lat !== 0 && office.lng !== 0 && <a className="map-link" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${office.lat}&mlon=${office.lng}#map=18/${office.lat}/${office.lng}`}>View this point on OpenStreetMap ↗</a>}
        </section></div></>}
      {(role === "HR" || tab !== "overview") && <section className="card content-card"><div className="card-head"><div><h2>{permittedTabs.find(([id]) => id === tab)?.[1] ?? "HR workspace"}</h2><p>Employee attendance and on-duty workflow.</p></div>{tab === "reports" && <button className="primary" onClick={exportCsv}>Download CSV</button>}</div>
        {tab === "overview" && <div className="stats"><Stat label="Employees" value={data.employees.length}/><Stat label="Present records" value={data.attendance.length}/><Stat label="Pending requests" value={data.requests.filter((r) => r.status === "PENDING").length}/></div>}
        {tab === "employees" && <><form className="form-grid employee-form" onSubmit={(event) => void addEmployee(event)}>
          <label>Employee ID<input required value={employee.id} onChange={(event) => setEmployee({ ...employee, id: event.target.value.toUpperCase() })}/></label>
          <label>Full name<input required value={employee.name} onChange={(event) => setEmployee({ ...employee, name: event.target.value })}/></label>
          <label>Work email<input required type="email" value={employee.email} onChange={(event) => setEmployee({ ...employee, email: event.target.value })}/></label>
          <label>Department<input required value={employee.department} onChange={(event) => setEmployee({ ...employee, department: event.target.value })}/></label>
          <label>Designation<input required value={employee.designation} onChange={(event) => setEmployee({ ...employee, designation: event.target.value })}/></label>
          <label className="wide">Employee face photo<input required type="file" accept="image/jpeg,image/png" onChange={(event) => setEmployeePhoto(event.target.files?.[0] ?? null)}/></label>
          {employeePhoto && <p className="photo-binding wide">This photo will be enrolled only under employee ID <strong>{employee.id || "(enter ID above)"}</strong>.</p>}
          <label className="consent-row wide"><input type="checkbox" checked={faceConsent} onChange={(event) => setFaceConsent(event.target.checked)}/><span>I have recorded the employee’s consent to face enrollment and attendance matching.</span></label>
          <button className="primary wide" type="submit" disabled={!employeePhoto || !faceConsent || employeeBusy}>{employeeBusy ? "Saving employee…" : "Save employee and enroll face photo"}</button>
          {employeeFeedback && <p role="status" aria-live="polite" className="employee-feedback wide" style={{ margin: 0, padding: "11px 13px", border: "1px solid", borderRadius: 7, fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere", background: employeeFeedback.kind === "error" ? "#fff0ee" : employeeFeedback.kind === "success" ? "#e9f8ef" : "#edf2ff", borderColor: employeeFeedback.kind === "error" ? "#f4c6c0" : employeeFeedback.kind === "success" ? "#bce8cd" : "#ced8ff", color: employeeFeedback.kind === "error" ? "#a83c30" : employeeFeedback.kind === "success" ? "#1e7048" : "#2e4eb8" }}>{employeeFeedback.text}</p>}
        </form><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Work email / sign-in</th><th>Department</th><th>Designation</th><th>Face enrollment</th>{role === "ADMIN" && <th>Account</th>}</tr></thead><tbody>{data.employees.length === 0 ? <tr><td colSpan={role === "ADMIN" ? 7 : 6} className="empty">No employees added yet.</td></tr> : data.employees.map((e) => <tr key={e.id}><td>{e.id}</td><td>{e.name}</td><td>{e.email ?? "—"}</td><td>{e.department}</td><td>{e.designation}</td><td>{e.faceEnrolled ? "Enrolled" : "Pending"}</td>{role === "ADMIN" && <td><button className="secondary-button" onClick={() => void resetEmployeePassword(e.id)}>Reset password</button></td>}</tr>)}</tbody></table></div></>}
        {role === "ADMIN" && tab === "hrUsers" && <><form className="form-grid employee-form" onSubmit={(event) => void addHrUser(event)}>
          <label>HR ID<input required pattern="HR[0-9]{3}" title="Use an ID such as HR001" value={hrUser.id} onChange={(event) => setHrUser({ ...hrUser, id: event.target.value.toUpperCase() })}/></label>
          <label>Full name<input required maxLength={120} value={hrUser.name} onChange={(event) => setHrUser({ ...hrUser, name: event.target.value })}/></label>
          <label>Work email<input required type="email" maxLength={254} value={hrUser.email} onChange={(event) => setHrUser({ ...hrUser, email: event.target.value })}/></label>
          <label>Department<input required maxLength={80} value={hrUser.department} onChange={(event) => setHrUser({ ...hrUser, department: event.target.value })}/></label>
          <p className="wide geo-message">No email is sent. A generated initial password is shown once after account creation. HR access follows the permissions set on the Admin overview.</p>
          <button className="primary wide" type="submit" disabled={hrCreateBusy}>{hrCreateBusy ? "Creating account…" : "Create HR account"}</button>
        </form><div className="table-wrap"><table><thead><tr><th>HR ID</th><th>Name</th><th>Department</th><th>Role</th></tr></thead><tbody>{data.hrUsers.length === 0 ? <tr><td colSpan={4} className="empty">No HR accounts yet.</td></tr> : data.hrUsers.map((hr) => <tr key={hr.accountId}><td>{hr.id}</td><td>{hr.name}</td><td>{hr.department}</td><td>HR</td></tr>)}</tbody></table></div></>}
        {tab === "attendance" && <Records records={data.attendance}/ >}
        {tab === "requests" && <div className="request-list">{data.requests.length === 0 ? <p className="empty">No on-duty requests yet.</p> : data.requests.map((r) => <article className="request" key={r.id}><div><strong>{r.employeeName} <span className="muted">({r.employeeId})</span></strong><p>{r.locationName} · {r.reason}</p><small>{new Date(r.createdAt).toLocaleString()} · {r.status}</small></div>{r.status === "PENDING" && <div className="actions"><button className="approve" onClick={() => void mutate({ action: "decision", id: r.id, status: "APPROVED" })}>Approve</button><button className="reject" onClick={() => void mutate({ action: "decision", id: r.id, status: "REJECTED" })}>Reject</button></div>}</article>)}</div>}
        {tab === "reports" && <Records records={data.attendance}/>}
      </section>}
    </section>
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Records({ records }: { records: DashboardData["attendance"] }) { return <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Date & time</th><th>Mode</th><th>Location</th></tr></thead><tbody>{records.length === 0 ? <tr><td colSpan={4} className="empty">No attendance records yet.</td></tr> : records.map((r) => <tr key={r.id}><td><strong>{r.employeeName}</strong><small>{r.employeeId}</small></td><td>{new Date(r.occurredAt).toLocaleString()}</td><td>{r.mode === "IN_OFFICE_GEOTAG" ? "Office geotag" : "Approved on-duty"}</td><td>{r.locationLabel}</td></tr>)}</tbody></table></div>; }

