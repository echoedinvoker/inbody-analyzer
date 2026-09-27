// Removes location and other metadata from uploaded photos before they are saved.
//
// JPEG: drops every APP1 (EXIF / XMP), APP13 (Photoshop/IPTC) and COM segment.
//       If the original EXIF carried an Orientation other than 1, a minimal EXIF
//       block containing only Orientation is written back, so phones' sideways
//       photos still display upright.
// PNG:  drops eXIf, tEXt, zTXt and iTXt chunks.
// Anything unparseable is returned unchanged (never throws): a failed strip must
// not block an upload; the tests pin the formats we actually receive.

export function stripMetadata(buf: Buffer, type: "jpeg" | "png"): Buffer {
  try {
    return type === "jpeg" ? stripJpeg(buf) : stripPng(buf);
  } catch {
    return buf;
  }
}

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const kept: Buffer[] = [];
  let orientation: number | null = null;
  let insertAt = 0; // index in `kept` after which the minimal EXIF goes
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("bad marker");
    let m = i + 1;
    while (m < buf.length && buf[m] === 0xff) m++; // fill bytes
    const marker = buf[m];
    if (marker === undefined) throw new Error("truncated");
    if (marker === 0xda) {
      kept.push(buf.subarray(i)); // start of scan: rest is image data
      i = buf.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(buf.subarray(i, m + 1));
      i = m + 1;
      continue;
    }
    if (m + 2 >= buf.length) throw new Error("truncated");
    const len = buf.readUInt16BE(m + 1);
    const end = m + 1 + len;
    if (len < 2 || end > buf.length) throw new Error("truncated");
    const segment = buf.subarray(i, end);
    if (marker === 0xe1) {
      orientation ??= orientationFromApp1(buf.subarray(m + 3, end));
    } else if (marker === 0xed || marker === 0xfe) {
      // drop
    } else {
      kept.push(segment);
      if (marker === 0xe0 && kept.length === 1) insertAt = 1; // keep JFIF APP0 first
    }
    i = end;
  }
  if (i !== buf.length) throw new Error("no scan");
  if (orientation !== null && orientation !== 1) kept.splice(insertAt, 0, minimalOrientationApp1(orientation));
  return Buffer.concat([buf.subarray(0, 2), ...kept]);
}

function orientationFromApp1(payload: Buffer): number | null {
  if (payload.length < 14 || payload.toString("latin1", 0, 6) !== "Exif\0\0") return null;
  const tiff = payload.subarray(6);
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return null;
}

function minimalOrientationApp1(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 offset
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export function readJpegOrientation(buf: Buffer): number | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      const o = orientationFromApp1(buf.subarray(i + 4, i + 2 + len));
      if (o !== null) return o;
    }
    i += 2 + len;
  }
  return null;
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function stripPng(buf: Buffer): Buffer {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return buf;
  const kept: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i < buf.length) {
    if (i + 12 > buf.length) throw new Error("truncated");
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error("truncated");
    if (!PNG_DROP.has(type)) kept.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  if (!sawEnd) throw new Error("no IEND");
  return Buffer.concat(kept);
}
