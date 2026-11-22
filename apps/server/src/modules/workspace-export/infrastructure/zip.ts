import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const dosDateTime = (d: Date) => ({
  time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  date: (Math.max(d.getUTCFullYear(), 1980) - 1980 << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
});

interface Entry {
  name: Buffer;
  method: 0 | 8;
  crc: number;
  compressed: Buffer;
  size: number;
  time: number;
  date: number;
  offset: number;
}

/**
 * A small ZIP writer (no ZIP64, so under 4 GB and 65535 entries: more is refused). Names are UTF-8; each file is deflated
 * unless that would not make it smaller. Used for the workspace export so no archive library joins the dependencies.
 */
export class ZipBuilder {
  readonly #entries: Entry[] = [];
  readonly #parts: Buffer[] = [];
  #offset = 0;

  get count(): number {
    return this.#entries.length;
  }

  add(path: string, data: Buffer, modified: Date = new Date()): void {
    if (this.#entries.length >= 0xffff) throw new Error('zip: too many entries');
    const name = Buffer.from(path, 'utf8');
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const compressed = stored ? data : deflated;
    if (data.length >= 0xffffffff || this.#offset + compressed.length >= 0xffffffff) throw new Error('zip: archive too large');
    const { time, date } = dosDateTime(modified);
    const entry: Entry = { name, method: stored ? 0 : 8, crc: crc32(data), compressed, size: data.length, time, date, offset: this.#offset };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    this.#parts.push(header, name, compressed);
    this.#offset += header.length + name.length + compressed.length;
    this.#entries.push(entry);
  }

  finish(): Buffer {
    const central: Buffer[] = [];
    let size = 0;
    for (const e of this.#entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed.length, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      central.push(h, e.name);
      size += h.length + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.#entries.length, 8);
    end.writeUInt16LE(this.#entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.#offset, 16);
    return Buffer.concat([...this.#parts, ...central, end]);
  }
}
