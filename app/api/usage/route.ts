import { NextResponse } from "next/server";
import { getUsage, usageErrorCode } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const result = await getUsage(url.searchParams.get("refresh") === "1");
  if (result.ok) {
    return NextResponse.json(result.payload);
  }
  return NextResponse.json(
    { error: result.error, code: usageErrorCode(result.status) },
    { status: result.status },
  );
}
