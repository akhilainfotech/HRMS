import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { supabase, profile } = await requireAppRole(request, ["EMPLOYEE"]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [office, attendance] = await Promise.all([
      supabase.from("office_geofences").select("name,latitude,longitude,radius_meters").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("attendance").select("id,employee_id,checked_in_at").eq("employee_id", profile.employee_id).eq("attendance_date", today).maybeSingle(),
    ]);
    if (office.error || attendance.error) return NextResponse.json({ error: "Could not load attendance settings." }, { status: 503 });
    return NextResponse.json({
      profile: { id: profile.employee_id, name: profile.full_name, department: profile.department ?? "" },
      office: office.data ? { name: office.data.name, lat: office.data.latitude, lng: office.data.longitude, allowedRadiusMeters: office.data.radius_meters } : null,
      todayAttendance: attendance.data ? { id: attendance.data.id, occurredAt: attendance.data.checked_in_at } : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status });
  }
}
