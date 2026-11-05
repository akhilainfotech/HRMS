import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const defaultPermissions = { hr_add_employee: true, hr_geotag_monitor: true, hr_od_approvals: true, hr_monthly_download: true };
const officeView = (row: any) => row ? ({ id: row.id, name: row.name, lat: row.latitude, lng: row.longitude, allowedRadiusMeters: row.radius_meters, accuracyMeters: row.anchor_accuracy_meters, capturedAt: row.captured_at }) : { name: "", lat: 0, lng: 0, allowedRadiusMeters: 250 };
const errorResponse = (error: unknown) => {
  const status = error instanceof AuthError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
};

export async function GET(request: NextRequest) {
  try {
    const { supabase, profile } = await requireAppRole(request, ["ADMIN", "HR"]);
    const [officeResult, settingsResult, employeeResult, attendanceResult, requestsResult, hrUsersResult] = await Promise.all([
      supabase.from("office_geofences").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("hr_access_settings").select("permissions").eq("singleton", true).maybeSingle(),
      supabase.from("employees").select("employee_id,full_name,department,designation,work_email,face_enrolled_at").order("employee_id"),
      supabase.from("attendance").select("id,employee_id,checked_in_at,latitude,longitude,accuracy_meters,distance_from_office_meters,face_similarity,face_model_id").order("checked_in_at", { ascending: false }).limit(500),
      supabase.from("duty_requests").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("profiles").select("user_id,employee_id,full_name,department").eq("role", "HR").order("employee_id"),
    ]);
    const failure = [officeResult, settingsResult, employeeResult, attendanceResult, requestsResult, hrUsersResult].find((result) => result.error);
    if (failure?.error) return NextResponse.json({ error: "Could not load HRMS data" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    const permissions = settingsResult.data?.permissions ?? defaultPermissions;
    const employeeNames = new Map((employeeResult.data ?? []).map((employee) => [employee.employee_id, employee.full_name]));
    return NextResponse.json({
      role: profile.role,
      permissions,
      office: officeView(officeResult.data),
      hrUsers: profile.role === "ADMIN" ? (hrUsersResult.data ?? []).map((hr) => ({ id: hr.employee_id ?? "Unassigned", accountId: hr.user_id, name: hr.full_name, department: hr.department ?? "" })) : [],
      employees: (profile.role === "ADMIN" || permissions.hr_add_employee ? employeeResult.data ?? [] : []).map((e) => ({ id: e.employee_id, name: e.full_name, department: e.department, designation: e.designation, email: e.work_email, faceEnrolled: !!e.face_enrolled_at })),
      attendance: (profile.role === "ADMIN" || permissions.hr_geotag_monitor ? attendanceResult.data ?? [] : []).map((a) => ({ id: a.id, employeeId: a.employee_id, employeeName: employeeNames.get(a.employee_id) ?? a.employee_id, occurredAt: a.checked_in_at, mode: "IN_OFFICE_GEOTAG", locationLabel: `Office check-in (${Math.round(a.distance_from_office_meters)} m)`, latitude: a.latitude, longitude: a.longitude, accuracyMeters: a.accuracy_meters, faceSimilarity: a.face_similarity, faceModelId: a.face_model_id })),
      requests: profile.role === "ADMIN" || permissions.hr_od_approvals ? (requestsResult.data ?? []).map((row) => ({ id: row.id, employeeId: row.employee_id, employeeName: employeeNames.get(row.employee_id) ?? row.employee_id, locationName: row.location_name, reason: row.reason, status: row.status, createdAt: row.created_at })) : [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOriginMutation(request);
    const { supabase, user, profile } = await requireAppRole(request, ["ADMIN", "HR"]);
    const body = await request.json();
    if (body.action === "office") {
      if (profile.role !== "ADMIN") throw new AuthError(403, "Only Admin can change the office geofence.");
      const office = body.office;
      if (!office || typeof office.name !== "string" || !office.name.trim() || !Number.isFinite(office.lat) || office.lat < -90 || office.lat > 90 || !Number.isFinite(office.lng) || office.lng < -180 || office.lng > 180 || !Number.isInteger(office.allowedRadiusMeters) || office.allowedRadiusMeters < 25 || office.allowedRadiusMeters > 5000) {
        return NextResponse.json({ error: "Enter a valid office name, coordinates, and radius (25–5000 m)." }, { status: 400 });
      }
      if (office.accuracyMeters !== undefined && (!Number.isFinite(office.accuracyMeters) || office.accuracyMeters > 50)) {
        return NextResponse.json({ error: "GPS fix is too imprecise. Capture a new location with 50 m accuracy or better." }, { status: 400 });
      }
      const { data: existing, error: readError } = await supabase.from("office_geofences").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (readError) throw readError;
      const values = { name: office.name.trim(), latitude: office.lat, longitude: office.lng, radius_meters: office.allowedRadiusMeters, anchor_accuracy_meters: office.accuracyMeters ?? null, captured_at: office.capturedAt ?? null, updated_by: user.id, updated_at: new Date().toISOString() };
      const save = existing ? supabase.from("office_geofences").update(values).eq("id", existing.id) : supabase.from("office_geofences").insert(values);
      const { error } = await save;
      if (error) throw error;
    } else if (body.action === "permissions") {
      if (profile.role !== "ADMIN") throw new AuthError(403, "Only Admin can change HR permissions.");
      const permissions = body.permissions;
      if (!permissions || Object.keys(defaultPermissions).some((key) => typeof permissions[key] !== "boolean")) return NextResponse.json({ error: "Invalid HR permissions." }, { status: 400 });
      const { error } = await supabase.from("hr_access_settings").upsert({ singleton: true, permissions, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
      if (error) throw error;
    } else if (body.action === "decision") {
      if (profile.role === "HR") {
        const { data: settings } = await supabase.from("hr_access_settings").select("permissions").eq("singleton", true).maybeSingle();
        if (settings?.permissions?.hr_od_approvals !== true) throw new AuthError(403, "Admin has disabled on-duty approvals for HR.");
      }
      if (!body.id || !["APPROVED", "REJECTED"].includes(body.status)) return NextResponse.json({ error: "Invalid request decision." }, { status: 400 });
      const { data: requestRow, error: requestError } = await supabase.from("duty_requests").select("*").eq("id", body.id).eq("status", "PENDING").single();
      if (requestError || !requestRow) return NextResponse.json({ error: "Request is missing or already decided." }, { status: 409 });
      const { error: updateError } = await supabase.from("duty_requests").update({ status: body.status, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", body.id).eq("status", "PENDING");
      if (updateError) throw updateError;
      if (body.status === "APPROVED") {
        const admin = createAdminClient();
        const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const { error } = await admin.from("attendance").insert({ employee_id: requestRow.employee_id, attendance_date: date, latitude: requestRow.latitude, longitude: requestRow.longitude, accuracy_meters: requestRow.accuracy_meters, distance_from_office_meters: 0, face_similarity: requestRow.face_similarity, face_model_id: requestRow.face_model_id });
        if (error && error.code !== "23505") throw error;
      }
    } else {
      return NextResponse.json({ error: "Unsupported action. Use the dedicated employee enrollment and attendance endpoints." }, { status: 400 });
    }

    return GET(request);
  } catch (error) { return errorResponse(error); }
}
