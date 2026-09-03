import { NextResponse } from "next/server";
import { getOmpVersion } from "@/lib/omp/omp-cli";

export const dynamic = "force-dynamic";

/** Runtime probe of the installed omp binary ("omp/17.1.3"), separate from the
 * build-time ompgui version — the two can legitimately drift. */
export async function GET() {
  const version = await getOmpVersion();
  return NextResponse.json(
    { version },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
