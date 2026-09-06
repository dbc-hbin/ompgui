import { NextResponse } from "next/server";
import { ModelCatalogError, searchPublicModelCatalog } from "@/lib/model-catalog-service";

export const dynamic = "force-dynamic";

// GET /api/models-config/catalog?q=<query>[&provider=<id>][&baseUrl=<url>][&limit=N]
// Keep the web query normalization; shared search owns the cache and ranking.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").slice(0, 120);
  const provider = (searchParams.get("provider") ?? "").slice(0, 120);
  const baseUrl = (searchParams.get("baseUrl") ?? "").slice(0, 500);
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.max(1, Math.min(100, (Number.isFinite(parsedLimit) ? parsedLimit : 50) || 50));

  try {
    return NextResponse.json(await searchPublicModelCatalog({ query, provider, baseUrl, limit }));
  } catch (error) {
    if (error instanceof ModelCatalogError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "The public model catalog is unavailable. Try again later.", code: "catalog_unavailable" }, { status: 502 });
  }
}
