import { NextResponse } from "next/server";
import { listRelayDevices } from "@/lib/relay/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ devices: listRelayDevices() });
}
