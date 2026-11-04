"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import "./location.css";
import type { DashboardData, Role } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const empty: DashboardData = {
  permissions: { hr_add_employee: true, hr_geotag_monitor: true, hr_od_approvals: true, hr_monthly_download: true },
  office: { name: "", lat: 0, lng: 0, allowedRadiusMeters: 250 }, attendance: [], requests: [], employees: [],
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
  const [employeePhoto, setEmployeePhoto] = useState<File | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [tab, setTab] = useState("overview");
  const [office, setOffice] = useState(empty.office);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMessage, setGeoMessage] = useState("");

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
    ["reports", "Monthly report", data.permissions.hr_monthly_download],
  ].filter(([, , enabled]) => role === "ADMIN" || enabled) as [string, string, boolean][], [data.permissions, role]);

  async function mutate(payload: object) {
    setMessage("");
    const response = await fetch("/api/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error ?? "Could not save changes"); return; }
    setData(result); setOffice(result.office); setMessage("Saved");
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

  async function signOut() {
    await createClient().auth.signOut(); setRole(null); setData(empty); setTab("overview"); setMessage("Signed out.");
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!employeePhoto) { setMessage("Choose an employee face photo to enroll."); return; }
    const form = new FormData();
    form.append("employeeId", employee.id); form.append("fullName", employee.name); form.append("department", employee.department);
    form.append("designation", employee.designation); form.append("workEmail", employee.email); form.append("faceConsent", String(faceConsent)); form.append("photo", employeePhoto);
    const response = await fetch("/api/employees", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error ?? "Employee enrollment failed."); return; }
    setMessage(`Employee ${result.employeeId} added; the face photo is enrolled for that ID and the account invitation was sent.`);
    setEmployee({ id: "", name: "", department: "", designation: "", email: "" }); setEmployeePhoto(null); setFaceConsent(false);
    await refresh();
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setGeoMessage("This browser does not provide geolocation."); return; }
    setGeoBusy(true); setGeoMessage("Getting a high-accuracy location fix…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const accuracyMeters = Math.round(coords.accuracy);
        setOffice({ ...office, lat: coords.latitude, lng: coords.longitude, accuracyMeters, capturedAt: new Date().toISOString() });
        setGeoMessage(`Current device location captured with ±${accuracyMeters} m reported accuracy. Save to set the office geofence.`);
        setGeoBusy(false);
      },
      (error) => { setGeoMessage(error.code === error.PERMISSION_DENIED ? "Location permission was denied." : "Could not get a location fix. Try again outdoors or enter coordinates manually."); setGeoBusy(false); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  function exportCsv() {
    const rows = [["Employee ID", "Name", "Date", "Time", "Mode", "Location"], ...data.attendance.map((r) => [r.employeeId, r.employeeName, new Date(r.occurredAt).toLocaleDateString(), new Date(r.occurredAt).toLocaleTimeString(), r.mode, r.locationLabel])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "attendance-present.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  if (!role) return <main className="auth-shell"><form className="auth-card" onSubmit={(event) => void signIn(event)}>
    <span className="brand-mark">H</span><p className="eyebrow">HRMS SECURE ACCESS</p><h1>Admin and HR sign in</h1><p>Use the account invited by your HRMS administrator.</p>
    {message && <p className="auth-error">{message}</p>}
    <label>Work email<input required type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)}/></label>
    <label>Password<input required type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)}/></label>
    <button className="primary" type="submit">Sign in</button>
  </form></main>;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">H</span><div><strong>PeopleOps</strong><small>ATTENDANCE</small></div></div>
      <p className="nav-label">WORKSPACE</p>{permittedTabs.map(([id, label]) => <button className={`nav-item ${tab === id ? "active" : ""}`} key={id} onClick={() => setTab(id)}>{label}</button>)}
      <div className="sidebar-bottom"><span className="dot"/>Authenticated workspace</div>
    </aside>
    <section className="main-area"><header className="topbar"><div><span className="eyebrow">HRMS / {role}</span><h1>{role === "ADMIN" ? "Admin console" : "HR workspace"}</h1></div><button className="signout-button" onClick={() => void signOut()}>Sign out</button></header>
      {message && <p className="notice">{message}</p>}
      {role === "ADMIN" && tab === "overview" && <><div className="welcome"><div><p className="eyebrow">ADMINISTRATION</p><h2>Attendance control center</h2><p>Configure the office geofence and choose which tools HR can access.</p></div><span className="welcome-icon">⌖</span></div>
        <div className="stats"><Stat label="Employees" value={data.employees.length}/><Stat label="Present today" value={data.attendance.filter((r) => new Date(r.occurredAt).toDateString() === new Date().toDateString()).length}/><Stat label="Pending requests" value={data.requests.filter((r) => r.status === "PENDING").length}/></div>
        <div className="columns"><section className="card"><div className="card-head"><div><h3>HR access</h3><p>Choose which HR workspace sections are available.</p></div><span className="tag">ROLE SETTINGS</span></div><div className="permission-list">{Object.entries(data.permissions).map(([key, value]) => <label className="permission" key={key}><span><strong>{labels[key]}</strong><small>HR access to this module</small></span><input type="checkbox" checked={value} onChange={(e) => void mutate({ action: "permissions", permissions: { ...data.permissions, [key]: e.target.checked } })}/></label>)}</div></section>
        <section className="card"><div className="card-head"><div><h3>Office geofence</h3><p>Capture the admin device’s current location or enter coordinates.</p></div><span className="tag green">LOCATION</span></div>
          <button className="secondary-button wide" type="button" disabled={geoBusy} onClick={useCurrentLocation}>{geoBusy ? "Locating…" : "Use my current location"}</button>
          {geoMessage && <p className="geo-message">{geoMessage}</p>}
          {office.accuracyMeters !== undefined && <p className="geo-message">Last GPS fix: ±{office.accuracyMeters} m accuracy{office.capturedAt ? ` · ${new Date(office.capturedAt).toLocaleString()}` : ""}</p>}
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void mutate({ action: "office", office }); }}><label className="wide">Office name<input required value={office.name} onChange={(e) => setOffice({ ...office, name: e.target.value })}/></label><label>Latitude<input required type="number" min="-90" max="90" step="any" value={office.lat} onChange={(e) => setOffice({ ...office, lat: Number(e.target.value), accuracyMeters: undefined, capturedAt: undefined })}/></label><label>Longitude<input required type="number" min="-180" max="180" step="any" value={office.lng} onChange={(e) => setOffice({ ...office, lng: Number(e.target.value), accuracyMeters: undefined, capturedAt: undefined })}/></label><label className="wide">Radius in meters<input required min="25" max="5000" type="number" value={office.allowedRadiusMeters} onChange={(e) => setOffice({ ...office, allowedRadiusMeters: Number(e.target.value) })}/></label><button className="primary wide" type="submit">Save geofence</button></form>
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
          <button className="primary wide" disabled={!employeePhoto || !faceConsent}>Add employee and enroll face photo</button>
        </form><div className="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Face enrollment</th></tr></thead><tbody>{data.employees.map((e) => <tr key={e.id}><td>{e.id}</td><td>{e.name}</td><td>{e.department}</td><td>{e.designation}</td><td>{e.faceEnrolled ? "Enrolled" : "Pending"}</td></tr>)}</tbody></table></div></>}
        {tab === "attendance" && <Records records={data.attendance}/ >}
        {tab === "requests" && <div className="request-list">{data.requests.length === 0 ? <p className="empty">No on-duty requests yet.</p> : data.requests.map((r) => <article className="request" key={r.id}><div><strong>{r.employeeName} <span className="muted">({r.employeeId})</span></strong><p>{r.locationName} · {r.reason}</p><small>{new Date(r.createdAt).toLocaleString()} · {r.status}</small></div>{r.status === "PENDING" && <div className="actions"><button className="approve" onClick={() => void mutate({ action: "decision", id: r.id, status: "APPROVED" })}>Approve</button><button className="reject" onClick={() => void mutate({ action: "decision", id: r.id, status: "REJECTED" })}>Reject</button></div>}</article>)}</div>}
        {tab === "reports" && <Records records={data.attendance}/>}
      </section>}
    </section>
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Records({ records }: { records: DashboardData["attendance"] }) { return <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Date & time</th><th>Mode</th><th>Location</th></tr></thead><tbody>{records.length === 0 ? <tr><td colSpan={4} className="empty">No attendance records yet.</td></tr> : records.map((r) => <tr key={r.id}><td><strong>{r.employeeName}</strong><small>{r.employeeId}</small></td><td>{new Date(r.occurredAt).toLocaleString()}</td><td>{r.mode === "IN_OFFICE_GEOTAG" ? "Office geotag" : "Approved on-duty"}</td><td>{r.locationLabel}</td></tr>)}</tbody></table></div>; }
