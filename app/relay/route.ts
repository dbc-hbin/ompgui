import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "WebSocket endpoint", code: "websocket_required" },
    { status: 426, headers: { Upgrade: "websocket", Connection: "Upgrade" } },
  );
}
