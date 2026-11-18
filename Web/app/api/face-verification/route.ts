import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";
const maxPhotoBytes = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAppRole(request, ["EMPLOYEE"]);
    if (!profile.employee_id) throw new AuthError(403, "Your account is not linked to an employee ID.");

    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File) || !["image/jpeg", "image/png"].includes(photo.type) || photo.size < 1 || photo.size > maxPhotoBytes) {
      return NextResponse.json({ error: "Capture a JPEG or PNG selfie no larger than 4 MB." }, { status: 400 });
    }

    const faceApiUrl = process.env.FACE_API_URL;
    const faceApiToken = process.env.FACE_API_TOKEN;
    if (!faceApiUrl || !faceApiToken) throw new AuthError(503, "Face verification is not configured.");

    const faceForm = new FormData();
    faceForm.append("image", new Blob([await photo.arrayBuffer()], { type: photo.type }), photo.name || "attendance-selfie.jpg");
    let response: Response;
    try {
      response = await fetch(`${faceApiUrl.replace(/\/$/, "")}/internal/employees/${encodeURIComponent(profile.employee_id)}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${faceApiToken}` },
        body: faceForm,
        cache: "no-store",
      });
    } catch {
      throw new AuthError(503, "Face service is unavailable. Try again in a moment.");
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = [404, 409, 422, 503].includes(response.status) ? response.status : 502;
      return NextResponse.json({ error: result.detail ?? "Face verification is unavailable." }, { status });
    }
    if (result.employee_id !== profile.employee_id || typeof result.model_id !== "string" || typeof result.matched !== "boolean") {
      throw new AuthError(502, "Face service returned an invalid verification result.");
    }

    return NextResponse.json({
      matched: result.matched,
      faceMatch: { matched: result.matched },
      message: result.matched ? "Face matched the enrollment for this employee ID." : "Face did not match the enrollment for this employee ID.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Face verification failed." }, {
      status, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
