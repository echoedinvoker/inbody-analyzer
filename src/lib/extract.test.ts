import { describe, test, expect, mock } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";

// Mock must be before any import that uses @anthropic-ai/sdk
const mockCreate = mock(() => ({
  content: [{ type: "text", text: '{"weight": 75, "is_inbody": true, "measured_at": null, "skeletal_muscle": null, "body_fat_mass": null, "body_fat_pct": null, "bmi": null, "total_body_water": null, "visceral_fat_level": null, "basal_metabolic_rate": null, "inbody_score": null, "device_type": "InBody 270", "segmental_lean": null, "segmental_fat": null}' }],
  usage: { input_tokens: 100, output_tokens: 50 },
}));

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const { extractFromPhoto } = await import("./extract.ts");

describe("extractFromPhoto", () => {
  test("base64 > 10MB → throws user-friendly error", async () => {
    mkdirSync("./data/test", { recursive: true });
    const bigBuf = Buffer.alloc(8 * 1024 * 1024);
    bigBuf[0] = 0xff; bigBuf[1] = 0xd8; bigBuf[2] = 0xff;
    writeFileSync("./data/test/big-photo.jpg", bigBuf);

    await expect(extractFromPhoto("./data/test/big-photo.jpg"))
      .rejects.toThrow("照片太大");
  });

  test("normal file → calls API and returns data", async () => {
    mkdirSync("./data/test", { recursive: true });
    writeFileSync("./data/test/small-photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));

    const result = await extractFromPhoto("./data/test/small-photo.jpg");
    expect(result.data.weight).toBe(75);
    expect(mockCreate).toHaveBeenCalled();
  });

  test("mediaType option overrides path-based detection", async () => {
    mkdirSync("./data/test", { recursive: true });
    writeFileSync("./data/test/small-photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

    mockCreate.mockClear();
    await extractFromPhoto("./data/test/small-photo.png", { mediaType: "image/png" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0] as any;
    expect(callArgs.messages[0].content[0].source.media_type).toBe("image/png");
  });
});
