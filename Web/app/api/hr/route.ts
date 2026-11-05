import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const hrIdPattern = /^HR\d{3}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let admin: ReturnType<typeof createAdminClient> | undefined;
  let createdAuthUserId: string | undefined;

  try {
    requireSameOriginMutation(request);
    await requireAppRole(request, ["ADMIN"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Send a valid HR account form." }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Send a valid HR account form." }, { status: 400 });
    }

    const form = body as Record<string, unknown>;
    const hrId = typeof form.hrId === "string" ? form.hrId.trim().toUpperCase() : "";
    const fullName = typeof form.fullName === "string" ? form.fullName.trim() : "";
    const department = typeof form.department === "string" ? form.department.trim() : "";
    const workEmail = typeof form.workEmail === "string" ? form.workEmail.trim().toLowerCase() : "";

    if (!hrIdPattern.test(hrId) || !fullName || fullName.length > 120 || !department || department.length > 80 || workEmail.length > 254 || !emailPattern.test(workEmail)) {
      return NextResponse.json({ error: "Enter an HR ID such as HR001, a name, department, and valid work email." }, { status: 400 });
    }

    admin = createAdminClient();
    const [existingProfile, existingEmployee] = await Promise.all([
      admin.from("profiles").select("user_id").eq("employee_id", hrId).maybeSingle(),
      admin.from("employees").select("employee_id").eq("employee_id", hrId).maybeSingle(),
    ]);
    if (existingProfile.error || existingEmployee.error) throw new Error("Could not check whether this HR ID is already in use.");
    if (existingProfile.data || existingEmployee.data) {
      return NextResponse.json({ error: `HR ID ${hrId} is already in use.` }, { status: 409 });
    }

    const initialPassword = randomBytes(24).toString("base64url");
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: workEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { hr_id: hrId, full_name: fullName, department },
    });
    if (createError || !created.user) {
      if (/already|registered|exists/i.test(createError?.message ?? "")) {
        throw new AuthError(409, "This email already has a Supabase account. Use a different email or link the existing account.");
      }
      throw new Error("Could not create the HR sign-in account.");
    }
    createdAuthUserId = created.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      user_id: created.user.id,
      role: "HR",
      employee_id: hrId,
      full_name: fullName,
      department,
    });
    if (profileError) {
      if (profileError.code === "23505") throw new AuthError(409, `HR ID ${hrId} is already in use.`);
      throw new Error("The HR account was created, but its HRMS profile could not be linked.");
    }

    return NextResponse.json({ hrId, role: "HR", initialPassword }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (createdAuthUserId && admin) await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof AuthError ? error.message : error instanceof Error ? error.message : "HR account creation failed.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}

