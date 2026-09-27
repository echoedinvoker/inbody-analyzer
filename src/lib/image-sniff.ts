export type ImageType = "jpeg" | "png" | "heic" | "unknown";

const HEIC_BRANDS = ["heic", "heix", "mif1", "msf1", "hevc"];

export function sniffImageType(buf: Buffer | Uint8Array): ImageType {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "png";
  }
  if (buf.length >= 12) {
    const ftyp = buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
    if (ftyp) {
      const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
      if (HEIC_BRANDS.includes(brand)) {
        return "heic";
      }
    }
  }
  return "unknown";
}
