import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { RELAY_MAX_FRAME_BYTES } from "./protocol";

export const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type WsOpcode = 1 | 2 | 8 | 9 | 10;

export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

export type ConsumeResult =
  | { status: "need_more" }
  | { status: "error"; code: number; reason: string }
  | { status: "ok"; frame: WsFrame; rest: Buffer };

export function websocketAcceptKey(key: string): string {
  return createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
}

export function isRelayUpgradePath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0];
  return path === "/relay";
}

export function readWebsocketUpgradeKey(req: IncomingMessage): string | null {
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  if (upgrade !== "websocket") return null;
  const connection = String(req.headers.connection ?? "");
  if (!/\bupgrade\b/i.test(connection)) return null;
  if (String(req.headers["sec-websocket-version"] ?? "") !== "13") return null;
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || key.length < 16 || key.length > 128) return null;
  return key;
}

export function encodeUnmaskedFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

export function encodeMaskedFrame(opcode: number, payload: Buffer, mask: Buffer): Buffer {
  if (mask.length !== 4) throw new Error("WebSocket mask must be 4 bytes");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len <= 0xffff) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
    mask.copy(header, 10);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, masked]);
}

export function tryConsumeClientFrame(buffer: Buffer, maxPayload = RELAY_MAX_FRAME_BYTES): ConsumeResult {
  if (buffer.length < 2) return { status: "need_more" };
  const byte0 = buffer[0];
  const byte1 = buffer[1];
  const fin = (byte0 & 0x80) !== 0;
  const rsv = byte0 & 0x70;
  const opcode = byte0 & 0x0f;
  const masked = (byte1 & 0x80) !== 0;
  let payloadLen = byte1 & 0x7f;
  if (rsv !== 0) return { status: "error", code: 1002, reason: "RSV bits must be 0" };
  if (!masked) return { status: "error", code: 1002, reason: "Client frames must be masked" };
  if (!fin) return { status: "error", code: 1003, reason: "Fragmented frames are not supported" };
  if (opcode !== 1 && opcode !== 8 && opcode !== 9 && opcode !== 10) {
    return { status: "error", code: 1003, reason: "Unsupported opcode" };
  }

  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return { status: "need_more" };
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return { status: "need_more" };
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    if (high !== 0 || low > maxPayload) {
      return { status: "error", code: 1009, reason: "Frame is too large" };
    }
    payloadLen = low;
    offset = 10;
  }
  if (payloadLen > maxPayload) return { status: "error", code: 1009, reason: "Frame is too large" };
  if ((opcode === 8 || opcode === 9 || opcode === 10) && payloadLen > 125) {
    return { status: "error", code: 1002, reason: "Control frame is too large" };
  }
  const total = offset + 4 + payloadLen;
  if (buffer.length < total) return { status: "need_more" };

  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, total));
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
  return {
    status: "ok",
    frame: { fin, opcode, payload },
    rest: buffer.subarray(total),
  };
}

export interface RelayWebSocketHandlers {
  onText(text: string): void;
  onClose(): void;
}

export class RelayWebSocket {
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private sentClose = false;
  bufferedAmount = 0;

  constructor(
    private readonly socket: Duplex,
    private readonly handlers: RelayWebSocketHandlers,
    private readonly maxPayload = RELAY_MAX_FRAME_BYTES,
  ) {
    this.socket.on("data", (chunk: Buffer) => this.onData(chunk));
    this.socket.on("end", () => this.handlePeerClose());
    this.socket.on("close", () => this.handlePeerClose());
    this.socket.on("error", () => this.handlePeerClose());
  }

  feed(chunk: Buffer): void {
    this.onData(chunk);
  }

  sendText(text: string): boolean {
    if (this.closed || !this.socket.writable) return false;
    const payload = Buffer.from(text, "utf8");
    if (payload.length > this.maxPayload) return false;
    return this.writeFrame(encodeUnmaskedFrame(1, payload));
  }

  ping(): void {
    if (this.closed || !this.socket.writable) return;
    this.writeFrame(encodeUnmaskedFrame(9, Buffer.alloc(0)));
  }

  close(code = 1000, reason = ""): void {
    if (this.sentClose) return;
    this.sentClose = true;
    const reasonBuf = Buffer.from(reason.slice(0, 120), "utf8");
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      this.socket.write(encodeUnmaskedFrame(8, payload));
    } catch {
      // ignore
    }
    this.closed = true;
    try { this.socket.end(); } catch { /* ignore */ }
    this.handlers.onClose();
  }

  private writeFrame(frame: Buffer): boolean {
    try {
      const writable = this.socket as Duplex & { writableLength?: number };
      this.bufferedAmount = typeof writable.writableLength === "number" ? writable.writableLength : 0;
      if (this.bufferedAmount > 1_000_000) return false;
      return this.socket.write(frame);
    } catch {
      this.handlePeerClose();
      return false;
    }
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxPayload + 14) {
      this.close(1009, "Frame is too large");
      return;
    }
    for (;;) {
      const result = tryConsumeClientFrame(this.buffer, this.maxPayload);
      if (result.status === "need_more") return;
      if (result.status === "error") {
        this.close(result.code, result.reason);
        return;
      }
      this.buffer = result.rest;
      this.dispatch(result.frame);
      if (this.closed) return;
    }
  }

  private dispatch(frame: WsFrame): void {
    switch (frame.opcode) {
      case 1: {
        const text = frame.payload.toString("utf8");
        if (Buffer.byteLength(text, "utf8") !== frame.payload.length) {
          this.close(1007, "Text frame is not valid UTF-8");
          return;
        }
        this.handlers.onText(text);
        return;
      }
      case 8:
        this.close(1000, "");
        return;
      case 9:
        this.writeFrame(encodeUnmaskedFrame(10, frame.payload));
        return;
      case 10:
        return;
      default:
        this.close(1003, "Unsupported opcode");
    }
  }

  private handlePeerClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.sentClose = true;
    this.handlers.onClose();
  }
}

export function completeRelayUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  handlers: RelayWebSocketHandlers,
): RelayWebSocket | null {
  const key = readWebsocketUpgradeKey(req);
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  const accept = websocketAcceptKey(key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n",
  );
  const ws = new RelayWebSocket(socket, handlers);
  if (head.length > 0) ws.feed(head);
  return ws;
}
