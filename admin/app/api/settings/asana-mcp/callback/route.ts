import { NextRequest, NextResponse } from "next/server";
import { completeAsanaOAuth } from "@/lib/asana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = getPublicOrigin(request);
  const expectedState = request.cookies.get("asana_oauth_state")?.value;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/platforms/asana/global-settings?asana_error=${encodeURIComponent(error)}`, origin),
    );
  }

  if (!expectedState || !state || expectedState !== state) {
    return NextResponse.redirect(
      new URL(
        `/platforms/asana/global-settings?asana_error=${encodeURIComponent("Asana OAuth state did not match.")}`,
        origin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/platforms/asana/global-settings?asana_error=${encodeURIComponent("Asana OAuth did not return a code.")}`,
        origin,
      ),
    );
  }

  try {
    await completeAsanaOAuth({ code, origin });
    const response = NextResponse.redirect(
      new URL("/platforms/asana/global-settings?asana_connected=1", origin),
    );
    response.cookies.delete("asana_oauth_state");
    return response;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not complete Asana OAuth.";
    return NextResponse.redirect(
      new URL(`/platforms/asana/global-settings?asana_error=${encodeURIComponent(message)}`, origin),
    );
  }
}

function getPublicOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("host");

  if (host) {
    url.host = host;
  }

  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  }

  return url.origin;
}
