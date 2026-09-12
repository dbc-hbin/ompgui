import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { applyNativeSettings, getNativeSettings, nativeSettingsErrorPayload } from "@/lib/omp/settings-service";

export const dynamic = "force-dynamic";
const MAX_SETTINGS_REQUEST_BYTES = 256 * 1024;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? undefined;
    const cwd = url.searchParams.get("cwd") ?? undefined;
    return NextResponse.json(await getNativeSettings({ ...(scope ? { scope } : {}), ...(cwd ? { cwd } : {}) }));
  } catch (error) {
    return NextResponse.json(nativeSettingsErrorPayload(error), { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await parseJsonWithinLimit<unknown>(request, MAX_SETTINGS_REQUEST_BYTES);
    return NextResponse.json(await applyNativeSettings(body));
  } catch (error) {
    return NextResponse.json(nativeSettingsErrorPayload(error), {
      status: error instanceof RequestBodyTooLargeError ? 413 : 400,
    });
  }
}
