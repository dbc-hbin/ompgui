export function encodeMaskedFrame(opcode, payload, mask) {
  if (mask.length !== 4) throw new Error("WebSocket mask must be 4 bytes");
  const len = payload.length;
  let header;
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

