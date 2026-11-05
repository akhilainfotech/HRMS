import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const employeeIdPattern = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
// Keep uploads below Vercel Functions' 4.5 MB request-body ceiling.
const maxPhotoBytes = 4 * 1024 * 1024;

async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("Could not check whether this work email already has an account.");
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
}

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

    // Reuse a pre-created employee Auth account when present. Do not change an
    // existing user's password or convert an Admin/HR profile into an employee.
    const initialPassword = randomBytes(24).toString("base64url");
    let authUserId: string;
    let passwordToShow: string | undefined;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: workEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { employee_id: employeeId },
    });
    if (created.user && !createError) {
      authUserId = created.user.id;
      createdAuthUserId = authUserId;
      passwordToShow = initialPassword;
    } else if (/already|registered|exists/i.test(createError?.message ?? "")) {
      const existingUser = await findAuthUserByEmail(admin, workEmail);
      if (!existingUser) throw new AuthError(409, "This email already has a Supabase account, but HRMS could not find it to link.");
      const { data: existingProfile, error: existingProfileError } = await admin.from("profiles")
        .select("role,employee_id").eq("user_id", existingUser.id).maybeSingle();
      if (existingProfileError) throw new Error("Could not check the existing account's HRMS role.");
      if (existingProfile && (existingProfile.role !== "EMPLOYEE" || existingProfile.employee_id !== employeeId)) {
        throw new AuthError(409, "This email is already linked to a different HRMS role or employee ID.");
      }
      authUserId = existingUser.id;
    } else {
      throw new Error("Could not create the employee sign-in account.");
    }
    const { error: profileError } = await admin.from("profiles").upsert({
      user_id: authUserId, role: "EMPLOYEE", employee_id: employeeId, full_name: fullName, department,
    }, { onConflict: "user_id" });
    if (profileError) throw new Error("Could not link the employee account to its HRMS profile.");
    const { error: linkError } = await admin.from("employees").update({ auth_user_id: authUserId }).eq("employee_id", employeeId);
    if (linkError) throw new Error("Could not link the employee account to the employee record.");
    return NextResponse.json({ employeeId, enrolled: true, initialPassword: passwordToShow, reusedAccount: !passwordToShow }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
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

