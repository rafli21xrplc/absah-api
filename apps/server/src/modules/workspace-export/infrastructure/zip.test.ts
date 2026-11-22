import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from '../domain/csv';
import { crc32, ZipBuilder } from './zip';

/** Reads the archive back by its central directory, the way an unzip tool does. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(crc32(data)).toBe(crc);
    files.set(name, Buffer.from(data));
    p += 46 + nameLength;
  }
  return files;
}

describe('ZipBuilder', () => {
  it('writes an archive that reads back, with UTF-8 names and both stored and deflated entries', () => {
    const zip = new ZipBuilder();
    const text = Buffer.from('nama,kelas\r\n'.repeat(500));
    zip.add('tabel/siswa.csv', text);
    zip.add('berkas/foto-ané.jpg', Buffer.from([1, 2, 3])); // too small to deflate: stored
    zip.add('kosong.csv', Buffer.alloc(0));
    expect(zip.count).toBe(3);
    const files = unzip(zip.finish());
    expect([...files.keys()]).toEqual(['tabel/siswa.csv', 'berkas/foto-ané.jpg', 'kosong.csv']);
    expect(files.get('tabel/siswa.csv')?.equals(text)).toBe(true);
    expect(files.get('berkas/foto-ané.jpg')).toEqual(Buffer.from([1, 2, 3]));
    expect(files.get('kosong.csv')?.length).toBe(0);
  });

  it('is a real zip: the system unzip tests it', () => {
    const zip = new ZipBuilder();
    zip.add('a.csv', Buffer.from('x'.repeat(2000)));
    zip.add('map/b.csv', Buffer.from('halo'));
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'absah-zip-')), 'a.zip');
    writeFileSync(file, zip.finish());
    try {
      expect(execFileSync('unzip', ['-tq', file], { encoding: 'utf8' })).toContain('No errors');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // no unzip on this machine; the read-back above still proves the format
      throw err;
    }
  });

  it('crc32 matches the known check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('csv', () => {
  it('quotes what must be quoted and writes null as empty', () => {
    expect(csvLine(['a', 'b,c', 'd"e', 'f\ng', null, undefined, 5, true])).toBe('a,"b,c","d""e","f\ng",,,5,true\r\n');
  });

  it('writes bytea the way Postgres does', () => {
    expect(csvCell(Buffer.from([0xde, 0xad]))).toBe('\\xdead');
  });

  it('writes dates as ISO and objects as JSON', () => {
    expect(csvCell(new Date('2026-11-22T01:02:03Z'))).toBe('2026-11-22T01:02:03.000Z');
    expect(csvCell(['a', 'b'])).toBe('"[""a"",""b""]"');
  });

  it('defuses text a spreadsheet would run as a formula, but not phone numbers or negatives', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('+62812000111')).toBe('+62812000111');
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell(-5)).toBe('-5');
  });
});
