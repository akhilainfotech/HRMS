import { NextResponse, type NextRequest } from "next/server";
import { AuthError, requireAppRole, requireSameOriginMutation } from "@/lib/supabase/request-auth";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginMutation(request);
    await requireAppRole(request, ["ADMIN"]);
    const { url } = await request.json();
    const match = typeof url === "string" && url.match(/^https:\/\/maps\.app\.goo\.gl\/([a-zA-Z0-9]{1,80})(?:\?[^#]*)?$/);
    if (!match) return NextResponse.json({ error: "Enter a Google Maps short share link." }, { status: 400 });
    const response = await fetch(`https://maps.app.goo.gl/${match[1]}`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const destination = new URL(response.headers.get("location") ?? "");
    if (destination.origin !== "https://www.google.com" || !destination.pathname.startsWith("/maps/")) {
      throw new Error("Invalid Google Maps destination");
    }
    return NextResponse.json({ url: destination.href });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not open this share link. Open it in Google Maps and copy the pin coordinates." }, { status: 422 });
  }
}
