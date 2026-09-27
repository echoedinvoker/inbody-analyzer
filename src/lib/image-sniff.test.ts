import { describe, test, expect } from "bun:test";
import { sniffImageType } from "./image-sniff.ts";

describe("sniffImageType", () => {
  test("JPEG: FF D8 FF", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(sniffImageType(buf)).toBe("jpeg");
  });

  test("PNG: 89 50 4E 47", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(sniffImageType(buf)).toBe("png");
  });

  test("HEIC: ftyp heic", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x0000001c, 0); // box size
    buf.write("ftyp", 4, "ascii");
    buf.write("heic", 8, "ascii");
    expect(sniffImageType(buf)).toBe("heic");
  });

  test("HEIC: ftyp heix", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x0000001c, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("heix", 8, "ascii");
    expect(sniffImageType(buf)).toBe("heic");
  });

  test("HEIC: ftyp mif1", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x0000001c, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("mif1", 8, "ascii");
    expect(sniffImageType(buf)).toBe("heic");
  });

  test("HEIC: ftyp msf1", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x0000001c, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("msf1", 8, "ascii");
    expect(sniffImageType(buf)).toBe("heic");
  });

  test("HEIC: ftyp hevc", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x0000001c, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("hevc", 8, "ascii");
    expect(sniffImageType(buf)).toBe("heic");
  });

  test("unknown format", () => {
    const buf = Buffer.alloc(12);
    expect(sniffImageType(buf)).toBe("unknown");
  });

  test("too short buffer", () => {
    const buf = Buffer.from([0xff, 0xd8]);
    expect(sniffImageType(buf)).toBe("unknown");
  });
});
