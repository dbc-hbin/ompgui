import { NextResponse } from "next/server";
import { ToolResultImagesTooLargeError } from "@/lib/image-attachments";
import { getToolResultImagesForEntry } from "@/lib/session-reader";
import { apiErrorResponse, resolveSessionPathOr404 } from "@/lib/api-utils";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;

  try {
    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) return resolved.response;
    const filePath = resolved.filePath;

    // Lenient JSONL parsing keeps omp's malformed-line tolerance.
    // Limits are enforced before payload reads/serialization; oversized
    // requests reject without materializing image bytes.
    const media = getToolResultImagesForEntry(filePath, entryId);
    if (!media) {
      return NextResponse.json({ error: "Tool result images not found", code: "tool_result_images_not_found" }, { status: 404 });
    }

    return NextResponse.json(media);
  } catch (error) {
    if (error instanceof ToolResultImagesTooLargeError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 413 });
    }
    return apiErrorResponse(error);
  }
}
