import { randomUUID } from "node:crypto";

const PHYSICAL_LIMIT = 256 * 1024;
const LOGICAL_LIMIT = 16 * 1024 * 1024;
const PART_LIMIT = 48 * 1024;
const COUNT_LIMIT = 342;
const ACTIVE_LIMIT = 4;
const TTL = 30_000;

export interface RelayChunkFrame {
  op: "chunk";
  transfer: string;
  index: number;
  count: number;
  data: string;
}

class RelayChunkError extends Error {
  constructor(readonly code: "relay_chunk_invalid" | "relay_frame_too_large") {
    super(code === "relay_frame_too_large" ? "Relay frame exceeds the size limit" : "Invalid relay chunk transfer");
    this.name = "RelayChunkError";
  }
}

export function encodeRelayFrames(frame: unknown): string[] {
  let text: string | undefined;
  try {
    text = JSON.stringify(frame);
  } catch {
    throw new RelayChunkError("relay_chunk_invalid");
  }
  if (text === undefined) throw new RelayChunkError("relay_chunk_invalid");
  const size = Buffer.byteLength(text, "utf8");
  if (size > LOGICAL_LIMIT) throw new RelayChunkError("relay_frame_too_large");
  if (size <= PHYSICAL_LIMIT) return [text];
  const bytes = Buffer.from(text, "utf8");
  const count = Math.ceil(size / PART_LIMIT);
  const transfer = randomUUID();
  const frames: string[] = [];
  for (let index = 0; index < count; index++) {
    frames.push(JSON.stringify({
      op: "chunk", transfer, index, count,
      data: bytes.subarray(index * PART_LIMIT, (index + 1) * PART_LIMIT).toString("base64"),
    } satisfies RelayChunkFrame));
  }
  return frames;
}

interface Transfer {
  count: number;
  expiresAt: number;
  bytes: number;
  parts: Buffer[];
}

export class RelayChunkAssembler {
  private readonly transfers = new Map<string, Transfer>();
  private bytes = 0;

  constructor(private readonly now: () => number = Date.now) {}

  clear(): void {
    this.transfers.clear();
    this.bytes = 0;
  }

  accept(frame: unknown): string | null {
    const now = this.now();
    for (const [id, transfer] of this.transfers) {
      if (now >= transfer.expiresAt) {
        this.bytes -= transfer.bytes;
        this.transfers.delete(id);
      }
    }
    if (typeof frame !== "object" || frame === null || Array.isArray(frame)
      || Object.keys(frame).length !== 5
      || !("op" in frame) || frame.op !== "chunk"
      || !("transfer" in frame) || typeof frame.transfer !== "string"
      || !/^[A-Za-z0-9_-]{1,64}$/.test(frame.transfer)
      || !("index" in frame) || typeof frame.index !== "number" || !Number.isSafeInteger(frame.index)
      || !("count" in frame) || typeof frame.count !== "number" || !Number.isSafeInteger(frame.count)
      || frame.count < 1 || frame.count > COUNT_LIMIT || frame.index < 0 || frame.index >= frame.count
      || !("data" in frame) || typeof frame.data !== "string"
      || frame.data.length === 0 || frame.data.length > PART_LIMIT / 3 * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) {
      throw new RelayChunkError("relay_chunk_invalid");
    }
    const part = Buffer.from(frame.data, "base64");
    if (part.length > PART_LIMIT || part.toString("base64") !== frame.data) {
      throw new RelayChunkError("relay_chunk_invalid");
    }
    let transfer = this.transfers.get(frame.transfer);
    if (transfer === undefined) {
      if (frame.index !== 0 || this.transfers.size >= ACTIVE_LIMIT) {
        throw new RelayChunkError("relay_chunk_invalid");
      }
      transfer = { count: frame.count, expiresAt: now + TTL, bytes: 0, parts: [] };
    }
    if (frame.count !== transfer.count || frame.index !== transfer.parts.length
      || transfer.bytes + part.length > LOGICAL_LIMIT || this.bytes + part.length > LOGICAL_LIMIT) {
      throw new RelayChunkError("relay_chunk_invalid");
    }
    transfer.parts.push(part);
    transfer.bytes += part.length;
    this.bytes += part.length;
    this.transfers.set(frame.transfer, transfer);
    if (transfer.parts.length !== transfer.count) return null;
    this.transfers.delete(frame.transfer);
    this.bytes -= transfer.bytes;
    let text: string;
    let decoded: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(transfer.parts, transfer.bytes));
      decoded = JSON.parse(text);
    } catch {
      throw new RelayChunkError("relay_chunk_invalid");
    }
    if (typeof decoded === "object" && decoded !== null && "op" in decoded && decoded.op === "chunk") {
      throw new RelayChunkError("relay_chunk_invalid");
    }
    return text;
  }
}
