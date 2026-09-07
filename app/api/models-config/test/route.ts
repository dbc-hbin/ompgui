import { NextResponse } from "next/server";
import { ModelVerificationError, verifyModelConfiguration } from "@/lib/omp/model-verification";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    return NextResponse.json(await verifyModelConfiguration(body));
  } catch (error) {
    if (error instanceof ModelVerificationError) {
      if (error.code === "models_config_invalid") {
        return NextResponse.json({ ok: false, error: error.message });
      }
      if (error.code === "model_test_unresolved") {
        return NextResponse.json({ ok: false, error: error.message, code: error.code, latencyMs: error.latencyMs });
      }
      if (error.code !== "model_test_failed") {
        return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Model configuration verification failed" }, { status: 500 });
  }
}
