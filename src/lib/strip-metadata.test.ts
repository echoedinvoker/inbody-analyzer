import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import jpeg from "jpeg-js";
import { stripMetadata, readJpegOrientation } from "./strip-metadata.ts";

// Fixtures are synthetic (96x64 gradient) with fake GPS 12°34'56"N 65°43'21"E,
// Orientation=6 and Make=SyntheticCam, written by exiv2 / ImageMagick
// (see scripts/make-exif-fixtures.sh). No real photos.
const FIX = `${import.meta.dir}/../test-fixtures`;
const gpsJpg = readFileSync(`${FIX}/gps.jpg`);
const gpsPng = readFileSync(`${FIX}/gps.png`);

// Independent of the parser under test: the GPSLatitude rational 12/1 34/1 56/1
// as raw bytes. exiv2 writes little-endian ("II") TIFF by default; ImageMagick
// may re-encode as either, so look for both.
function rationalBytes(le: boolean) {
  const b = Buffer.alloc(24);
  [12, 1, 34, 1, 56, 1].forEach((v, i) => (le ? b.writeUInt32LE(v, i * 4) : b.writeUInt32BE(v, i * 4)));
  return b;
}
const hasFakeLatitude = (buf: Buffer) =>
  buf.includes(rationalBytes(true)) || buf.includes(rationalBytes(false));

describe("fixtures really carry GPS (guards against a vacuous green)", () => {
  test("gps.jpg contains the latitude rational and the Make string", () => {
    expect(hasFakeLatitude(gpsJpg)).toBe(true);
    expect(gpsJpg.includes(Buffer.from("SyntheticCam"))).toBe(true);
  });
  test("gps.png contains the latitude rational", () => {
    expect(hasFakeLatitude(gpsPng)).toBe(true);
  });
});

describe("stripMetadata — JPEG", () => {
  const out = stripMetadata(gpsJpg, "jpeg");

  test("removes GPS and other EXIF fields", () => {
    expect(hasFakeLatitude(out)).toBe(false);
    expect(out.includes(Buffer.from("SyntheticCam"))).toBe(false);
  });

  test("keeps Orientation so the photo still displays upright", () => {
    expect(readJpegOrientation(gpsJpg)).toBe(6);
    expect(readJpegOrientation(out)).toBe(6);
  });

  test("still decodes to the same pixels size", () => {
    const img = jpeg.decode(out);
    expect([img.width, img.height]).toEqual([96, 64]);
  });

  test("JPEG without EXIF passes through decodable and without inventing orientation", () => {
    const plain = Buffer.from(jpeg.encode({ data: Buffer.alloc(8 * 8 * 4, 128), width: 8, height: 8 }, 80).data);
    const o = stripMetadata(plain, "jpeg");
    expect(readJpegOrientation(o)).toBe(null);
    expect(jpeg.decode(o).width).toBe(8);
  });

  test("malformed JPEG is returned unchanged rather than throwing", () => {
    const junk = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]);
    expect(stripMetadata(junk, "jpeg")).toEqual(junk);
  });
});

describe("stripMetadata — PNG", () => {
  const out = stripMetadata(gpsPng, "png");

  test("removes eXIf / text chunks carrying GPS", () => {
    expect(hasFakeLatitude(out)).toBe(false);
  });

  test("keeps a valid PNG (signature, IHDR first, IEND last)", () => {
    expect(out.subarray(0, 8)).toEqual(gpsPng.subarray(0, 8));
    expect(out.toString("ascii", 12, 16)).toBe("IHDR");
    expect(out.toString("ascii", out.length - 8, out.length - 4)).toBe("IEND");
  });
});
