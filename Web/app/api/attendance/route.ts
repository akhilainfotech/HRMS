import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Keep requests below Vercel Functions' 4.5 MB request-body ceiling.
const maxPhotoBytes = 4 * 1024 * 1024;
const radians = (value: number) => value * Math.PI / 180;
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = radians(lat2 - lat1), dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAppRole(request, ["EMPLOYEE"]);
    if (!profile.employee_id) throw new AuthError(403, "Your account is not linked to an employee ID.");
    const form = await request.formData();
    const image = form.get("photo");
    const latitude = Number(form.get("latitude"));
    const longitude = Number(form.get("longitude"));
    const accuracy = Number(form.get("accuracyMeters"));
    if (!(image instanceof File) || !["image/jpeg", "image/png"].includes(image.type) || image.size < 1 || image.size > maxPhotoBytes) {
      return NextResponse.json({ error: "Capture a JPEG or PNG selfie no larger than 4 MB." }, { status: 400 });
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50) {
      return NextResponse.json({ error: "A current GPS fix with 50 m accuracy or better is required." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: office, error: officeError } = await admin.from("office_geofences").select("name,latitude,longitude,radius_meters").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (officeError) throw officeError;
    if (!office) return NextResponse.json({ error: "The office geofence has not been configured." }, { status: 409 });
    const distance = distanceMeters(latitude, longitude, office.latitude, office.longitude);
    if (distance + accuracy > office.radius_meters) return NextResponse.json({ error: "Your GPS location is outside the office geofence or too close to its boundary." }, { status: 403 });

    const faceApiUrl = process.env.FACE_API_URL;
    const faceApiToken = process.env.FACE_API_TOKEN;
    if (!faceApiUrl || !faceApiToken) throw new AuthError(503, "Face verification is not configured.");
    const faceForm = new FormData();
    faceForm.append("image", new Blob([await image.arrayBuffer()], { type: image.type }), image.name || "attendance-selfie.jpg");
    const faceResponse = await fetch(`${faceApiUrl.replace(/\/$/, "")}/internal/employees/${encodeURIComponent(profile.employee_id)}/verify`, {
      method: "POST", headers: { Authorization: `Bearer ${faceApiToken}` }, body: faceForm, cache: "no-store",
    });
    const faceResult = await faceResponse.json().catch(() => ({}));
    if (!faceResponse.ok) return NextResponse.json({ error: faceResult.detail ?? "Face verification is unavailable." }, { status: faceResponse.status === 503 ? 503 : 403 });
    if (faceResult.employee_id !== profile.employee_id || typeof faceResult.model_id !== "string") {
      return NextResponse.json({ error: "Face did not match the enrollment for your employee ID." }, { status: 403 });
    }
    if (faceResult.matched !== true || typeof faceResult.similarity !== "number") {
      return NextResponse.json({
        error: "Face did not match the enrollment for your employee ID. Retake the selfie and try again.",
        faceMatch: { matched: false },
      }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }

    const attendanceDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const { data, error } = await admin.from("attendance").insert({
      employee_id: profile.employee_id, attendance_date: attendanceDate, latitude, longitude,
      accuracy_meters: accuracy, distance_from_office_meters: Math.round(distance),
      face_similarity: faceResult.similarity, face_model_id: faceResult.model_id,
    }).select("id,checked_in_at").single();
    if (error?.code === "23505") return NextResponse.json({ error: "Attendance is already marked for today." }, { status: 409 });
    if (error || !data) throw error ?? new Error("Could not save attendance.");
    return NextResponse.json({ attendance: { id: data.id, occurredAt: data.checked_in_at }, faceVerified: true, faceMatch: { matched: true } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Attendance failed" }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}

