import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const employeeIdPattern = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
// Keep uploads below Vercel Functions' 4.5 MB request-body ceiling.
const maxPhotoBytes = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let insertedEmployeeId: string | undefined;
  let createdAuthUserId: string | undefined;
  let admin: ReturnType<typeof createAdminClient> | undefined;
  try {
    requireSameOriginMutation(request);
    const { supabase, user, profile } = await requireAppRole(request, ["ADMIN", "HR"]);
    admin = createAdminClient();
    if (profile.role === "HR") {
      const { data: settings } = await supabase.from("hr_access_settings").select("permissions").eq("singleton", true).maybeSingle();
      if (settings?.permissions?.hr_add_employee !== true) throw new AuthError(403, "Admin has disabled employee onboarding for HR.");
    }

    const form = await request.formData();
    const employeeId = String(form.get("employeeId") ?? "").trim().toUpperCase();
    const fullName = String(form.get("fullName") ?? "").trim();
    const department = String(form.get("department") ?? "").trim();
    const designation = String(form.get("designation") ?? "").trim();
    const workEmail = String(form.get("workEmail") ?? "").trim().toLowerCase();
    const consent = form.get("faceConsent") === "true";
    const photo = form.get("photo");

    if (!employeeIdPattern.test(employeeId) || !fullName || !department || !designation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
      return NextResponse.json({ error: "Enter a valid employee ID, name, work email, department, and designation." }, { status: 400 });
    }
    if (!consent) return NextResponse.json({ error: "Record the employee’s consent before face enrollment." }, { status: 400 });
    if (!(photo instanceof File) || !["image/jpeg", "image/png"].includes(photo.type) || photo.size < 1 || photo.size > maxPhotoBytes) {
      return NextResponse.json({ error: "Choose a JPEG or PNG face photo no larger than 4 MB." }, { status: 400 });
    }

    const { data: employee, error: insertError } = await admin.from("employees").insert({
      employee_id: employeeId, full_name: fullName, work_email: workEmail, department, designation,
      created_by: user.id, face_consent_at: new Date().toISOString(), face_consent_by: user.id,
    }).select("employee_id").single();
    if (insertError || !employee) return NextResponse.json({ error: insertError?.code === "23505" ? "Employee ID or work email is already registered." : "Could not create employee record." }, { status: insertError?.code === "23505" ? 409 : 500 });
    insertedEmployeeId = employee.employee_id;

    const faceApiUrl = process.env.FACE_API_URL;
    const faceApiToken = process.env.FACE_API_TOKEN;
    if (!faceApiUrl || !faceApiToken) throw new AuthError(503, "Face service is not configured on the web server.");
    const faceForm = new FormData();
    faceForm.append("enrolled_by", user.id);
    faceForm.append("image", new Blob([await photo.arrayBuffer()], { type: photo.type }), photo.name || `${employeeId}.jpg`);
    const faceResponse = await fetch(`${faceApiUrl.replace(/\/$/, "")}/internal/employees/${encodeURIComponent(employeeId)}/enrollment`, {
      method: "POST", headers: { Authorization: `Bearer ${faceApiToken}` }, body: faceForm, cache: "no-store",
    });
    if (!faceResponse.ok) {
      const detail = await faceResponse.json().catch(() => ({}));
      throw new Error(detail.detail ?? "Face enrollment failed. Check the photo and face service.");
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(workEmail, { data: { employee_id: employeeId } });
    if (inviteError || !invited.user) {
      throw new Error("Employee invitation could not be sent. Check Supabase Auth email delivery, then retry onboarding.");
    }
    createdAuthUserId = invited.user.id;
    const { error: profileError } = await admin.from("profiles").upsert({
      user_id: invited.user.id, role: "EMPLOYEE", employee_id: employeeId, full_name: fullName, department,
    }, { onConflict: "user_id" });
    if (profileError) throw new Error("Employee was invited, but the HRMS profile could not be linked. Contact an administrator.");
    const { error: linkError } = await admin.from("employees").update({ auth_user_id: invited.user.id }).eq("employee_id", employeeId);
    if (linkError) throw new Error("Employee was invited, but the employee ID link could not be completed.");
    return NextResponse.json({ employeeId, enrolled: true, invitePending: false }, { status: 201 });
  } catch (error) {
    const faceApiUrl = process.env.FACE_API_URL;
    const faceApiToken = process.env.FACE_API_TOKEN;
    if (insertedEmployeeId && faceApiUrl && faceApiToken) {
      await fetch(`${faceApiUrl.replace(/\/$/, "")}/internal/employees/${encodeURIComponent(insertedEmployeeId)}/enrollment`, { method: "DELETE", headers: { Authorization: `Bearer ${faceApiToken}` }, cache: "no-store" }).catch(() => undefined);
    }
    if (createdAuthUserId && admin) await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    if (insertedEmployeeId && admin) await admin.from("employees").delete().eq("employee_id", insertedEmployeeId);
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Employee enrollment failed.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
