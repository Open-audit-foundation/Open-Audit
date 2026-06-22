import { describe, expect, it, vi } from "vitest";
import {
  LengthPrefixedMessageDecoder,
  renderCaptiveCoreToml,
} from "../captive-core";

vi.mock("../../telemetry/index", () => ({
  captureExceptionSync: vi.fn(),
}));

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

describe("LengthPrefixedMessageDecoder", () => {
  it("reassembles framed messages across chunk boundaries", () => {
    const decoder = new LengthPrefixedMessageDecoder();
    const first = Buffer.from("hello");
    const second = Buffer.from("world");
    const combined = Buffer.concat([frame(first), frame(second)]);

    const partA = combined.subarray(0, 7);
    const partB = combined.subarray(7);

    expect(decoder.push(partA)).toEqual([]);
    expect(decoder.push(partB)).toEqual([first, second]);
  });
});

describe("renderCaptiveCoreToml", () => {
  it("renders passphrase and history archives into TOML", () => {
    const toml = renderCaptiveCoreToml({
      networkPassphrase: "Test SDF Network ; September 2015",
      historyArchives: {
        primary: {
          get: "https://history.example.com",
          put: "s3://history-bucket",
        },
      },
      httpPort: 11626,
    });

    expect(toml).toContain('NETWORK_PASSPHRASE="Test SDF Network ; September 2015"');
    expect(toml).toContain('[HISTORY."primary"]');
    expect(toml).toContain('get="https://history.example.com"');
    expect(toml).toContain('put="s3://history-bucket"');
  });
});
