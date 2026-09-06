import { encode } from "uqr";

const MAX_QR_CHARS = 2048;

/**
 * Encode `text` as a byte-mode QR matrix (`true` = dark module).
 * Empty or oversized payloads return null so the pairing page can fall back
 * to the copyable link instead of a broken image.
 */
export function pairingQrMatrix(text: string): boolean[][] | null {
  const payload = text.trim();
  if (!payload || payload.length > MAX_QR_CHARS) return null;
  try {
    const { data } = encode(payload, { ecc: "M" });
    if (!Array.isArray(data) || data.length < 21) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Render a pairing URI as an inline SVG (no third-party image URL).
 * Dark modules are filled with `currentColor` so the panel theme applies.
 */
export function pairingQrSvg(text: string): string | null {
  const matrix = pairingQrMatrix(text);
  if (!matrix) return null;
  const size = matrix.length;
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = matrix[y];
    if (!row || row.length !== size) return null;
    for (let x = 0; x < size; x += 1) {
      if (row[x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  const path = parts.join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="#fff"/><path fill="currentColor" d="${path}"/></svg>`;
}
