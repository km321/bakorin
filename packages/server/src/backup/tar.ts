/**
 * Minimal tar (ustar) writer and reader used for backup downloads and restoring
 * a downloaded backup. Only regular files and directories are supported, which
 * is all a Bakorin backup contains. Long paths use the GNU "L" record.
 */

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TarEntry {
  path: string;
  size: number;
  mtime?: Date;
  /** Bytes, or a function that yields them in chunks (for large files). */
  data: Uint8Array | (() => AsyncIterable<Uint8Array> | Promise<Uint8Array>);
}

function writeString(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  block.set(bytes.subarray(0, length), offset);
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  const text = Math.floor(value).toString(8).padStart(length - 1, "0");
  writeString(block, offset, length - 1, text);
  block[offset + length - 1] = 0;
}

function header(name: string, size: number, type: string, mtime: Date): Uint8Array {
  const block = new Uint8Array(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime.getTime() / 1000);
  block.fill(32, 148, 156);
  writeString(block, 156, 1, type);
  writeString(block, 257, 6, "ustar");
  writeString(block, 263, 2, "00");
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  writeString(block, 148, 7, `${sum.toString(8).padStart(6, "0")}\0`);
  block[155] = 32;
  return block;
}

function padding(size: number): Uint8Array {
  const rest = size % BLOCK;
  return new Uint8Array(rest === 0 ? 0 : BLOCK - rest);
}

function safePath(path: string): string {
  const clean = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (clean.split("/").some((part) => part === "..")) {
    throw new Error(`unsafe path in archive: ${path}`);
  }
  return clean;
}

function headersFor(path: string, size: number, type: string, mtime: Date): Uint8Array[] {
  const name = safePath(path);
  const bytes = encoder.encode(name);
  if (bytes.length < 100) {
    return [header(name, size, type, mtime)];
  }
  const longName = new Uint8Array(bytes.length + 1);
  longName.set(bytes);
  return [
    header("././@LongLink", longName.length, "L", mtime),
    longName,
    padding(longName.length),
    header(name.slice(0, 99), size, type, mtime),
  ];
}

/** Streams a tar archive of the given entries. Pipe through gzip for .tar.gz. */
export function tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>): ReadableStream<Uint8Array> {
  async function* generate(): AsyncGenerator<Uint8Array> {
    for await (const entry of entries) {
      const mtime = entry.mtime ?? new Date();
      for (const part of headersFor(entry.path, entry.size, "0", mtime)) {
        yield part;
      }
      let written = 0;
      if (entry.data instanceof Uint8Array) {
        written = entry.data.length;
        yield entry.data;
      } else {
        const produced = entry.data();
        if (produced instanceof Promise) {
          const bytes = await produced;
          written = bytes.length;
          yield bytes;
        } else {
          for await (const chunk of produced) {
            written += chunk.length;
            yield chunk;
          }
        }
      }
      if (written !== entry.size) {
        throw new Error(`size changed while archiving ${entry.path}`);
      }
      yield padding(written);
    }
    yield new Uint8Array(BLOCK * 2);
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Skip empty chunks: pull must enqueue something or the stream stalls.
        for (;;) {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }
          if (next.value.length > 0) {
            controller.enqueue(next.value);
            return;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export function gzipStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end >= 0 ? slice.subarray(0, end) : slice);
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

export interface ExtractedFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Reads a tar archive (optionally gzipped) fully in memory. Rejects absolute
 * paths, "..", links and anything that is not a file or directory.
 */
export function readTar(input: Uint8Array): ExtractedFile[] {
  const data = input[0] === 0x1f && input[1] === 0x8b ? Bun.gunzipSync(input as Uint8Array<ArrayBuffer>) : input;
  const files: ExtractedFile[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + BLOCK <= data.length) {
    const block = data.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) {
      break;
    }
    const size = readOctal(block, 124, 12);
    const type = String.fromCharCode(block[156] ?? 48);
    const prefix = readString(block, 345, 155);
    let name = readString(block, 0, 100);
    if (prefix) {
      name = `${prefix}/${name}`;
    }
    const start = offset + BLOCK;
    const body = data.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "L") {
      longName = readString(body, 0, body.length);
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }
    if (type === "5") {
      continue;
    }
    if (type === "x" || type === "g") {
      continue;
    }
    if (type !== "0" && type !== "\0") {
      throw new Error(`unsupported entry in archive: ${name}`);
    }
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
      throw new Error(`absolute path in archive: ${name}`);
    }
    files.push({ path: safePath(name), bytes: body.slice() });
  }
  return files;
}
