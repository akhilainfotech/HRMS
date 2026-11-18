import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const { supabase, profile } = await requireAppRole(request, ["ADMIN", "HR"]);
    if (profile.role === "HR") {
      const { data, error } = await supabase.from("hr_access_settings").select("permissions").eq("singleton", true).maybeSingle();
      if (error) throw new AuthError(503, "Could not check attendance access.");
      if (data && data.permissions?.hr_geotag_monitor !== true) throw new AuthError(403, "Attendance monitor access is required.");
    }
    const { id } = await context.params;
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new AuthError(400, "Invalid attendance record.");
    const { data: record, error: recordError } = await supabase.from("attendance").select("id").eq("id", id).maybeSingle();
    if (recordError) throw new AuthError(503, "Could not load the attendance record.");
    if (!record) throw new AuthError(404, "Attendance record not found.");
    const { data, error } = await createAdminClient().storage.from("attendance-evidence").download(id);
    if (error || !data) {
      if (error && "status" in error && Number(error.status) !== 404) throw new AuthError(503, "Could not load the check-in selfie.");
      throw new AuthError(404, "No selfie was retained for this check-in.");
    }
    if (!["image/jpeg", "image/png"].includes(data.type)) throw new AuthError(503, "Unsupported selfie format.");
    return new NextResponse(data, { headers: { ...headers, "Content-Type": data.type } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthError ? error.message : "Could not load the check-in selfie." }, {
      status: error instanceof AuthError ? error.status : 500, headers,
    });
  }
}
