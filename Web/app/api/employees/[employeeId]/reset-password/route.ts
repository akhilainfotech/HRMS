import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ employeeId: string }> }) {
  try {
    requireSameOriginMutation(request);
    await requireAppRole(request, ["ADMIN"]);
    const { employeeId } = await context.params;
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(employeeId)) throw new AuthError(400, "Invalid employee ID.");

    const admin = createAdminClient();
    const { data: employee, error: employeeError } = await admin.from("employees")
      .select("auth_user_id").eq("employee_id", employeeId).maybeSingle();
    if (employeeError) throw new Error("Could not load the employee account.");
    if (!employee?.auth_user_id) throw new AuthError(409, "This employee has no linked sign-in account.");

    const temporaryPassword = randomBytes(18).toString("base64url");
    const { error } = await admin.auth.admin.updateUserById(employee.auth_user_id, { password: temporaryPassword });
    if (error) throw new Error("Could not reset the employee password.");

    return NextResponse.json({ employeeId, temporaryPassword }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Password reset failed." }, {
      status, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
