import { describe, expect, test } from "bun:test";
import { gzipStream, readTar, tarStream } from "@bakorin/server";

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("tar", () => {
  test("round-trips files, long paths and block-sized files through gzip", async () => {
    const long = `backup/${"deep/".repeat(30)}file.txt`;
    const exact = new Uint8Array(1024).fill(7);
    const entries = [
      { path: "backup/manifest.json", size: 2, data: new TextEncoder().encode("{}") },
      { path: long, size: 5, data: async () => new TextEncoder().encode("hello") },
      {
        path: "backup/exact.bin",
        size: exact.length,
        data: async function* () {
          yield exact.subarray(0, 512);
          yield exact.subarray(512);
        },
      },
      { path: "backup/empty.txt", size: 0, data: new Uint8Array() },
    ];
    const archive = await bytesOf(gzipStream(tarStream(entries)));
    expect(archive[0]).toBe(0x1f);
    const files = readTar(archive);
    expect(files.map((file) => file.path)).toEqual(["backup/manifest.json", long, "backup/exact.bin", "backup/empty.txt"]);
    expect(new TextDecoder().decode(files[1]!.bytes)).toBe("hello");
    expect(files[2]!.bytes).toEqual(exact);
    expect(files[3]!.bytes.length).toBe(0);
  });

  test("rejects path traversal on write and read", async () => {
    expect(() => readTar(new Uint8Array(1024))).not.toThrow();
    const stream = tarStream([{ path: "../escape.txt", size: 1, data: new Uint8Array([1]) }]);
    await expect(bytesOf(stream)).rejects.toThrow(/unsafe path/);
    // Hand-built header with "../" in the name.
    const header = new Uint8Array(512);
    header.set(new TextEncoder().encode("../evil.txt"), 0);
    header.set(new TextEncoder().encode("00000000001\0"), 124);
    header[156] = 48;
    const archive = new Uint8Array(512 * 4);
    archive.set(header, 0);
    archive[512] = 65;
    expect(() => readTar(archive)).toThrow(/unsafe path/);
  });

  test("a file whose size changes while archiving fails loudly", async () => {
    const stream = tarStream([{ path: "a.txt", size: 10, data: async () => new Uint8Array(3) }]);
    await expect(bytesOf(stream)).rejects.toThrow(/size changed/);
  });
});
