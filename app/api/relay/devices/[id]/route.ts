import { NextResponse } from "next/server";
import { revokeRelayDevice } from "@/lib/relay/registry";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !id.startsWith("d_") || id.length > 80) {
    return NextResponse.json({ error: "Unknown device", code: "device_not_found" }, { status: 404 });
  }
  const revoked = revokeRelayDevice(id);
  if (!revoked) {
    return NextResponse.json({ error: "Unknown device", code: "device_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
