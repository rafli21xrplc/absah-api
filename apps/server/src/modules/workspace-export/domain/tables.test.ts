import { describe, expect, it } from 'vitest';
import { encryptionContext, fileEntryName, isExportedTable, looksEncrypted, omitColumn, tableEntryName } from './tables';

describe('what the workspace export carries', () => {
  it('leaves out secrets and queues, keeps the school data, and tppk only on request', () => {
    expect(isExportedTable('public', 'students', false)).toBe(true);
    expect(isExportedTable('public', 'gate_secrets', false)).toBe(false);
    expect(isExportedTable('public', 'outbox_events', true)).toBe(false);
    expect(isExportedTable('tppk', 'reports', false)).toBe(false);
    expect(isExportedTable('tppk', 'reports', true)).toBe(true);
  });

  it('omits hash and secret columns only', () => {
    expect(['nik_hash', 'phone_hash', 'ip_hash', 'secret', 'token_hash'].every(omitColumn)).toBe(true);
    expect(['name', 'hashtag_count', 'secretary'].some(omitColumn)).toBe(false);
  });

  it('names entries by table and file', () => {
    expect(tableEntryName('public', 'students')).toBe('tabel/students.csv');
    expect(tableEntryName('tppk', 'cases')).toBe('tabel/tppk/cases.csv');
    expect(fileEntryName('schools/8f1c/visitors/0192-aa')).toBe('berkas/visitors/0192-aa');
  });

  it('recognises ciphertext and builds the same AAD the columns were written with', () => {
    expect(looksEncrypted('v1:k1:aXY:dGFn:ZGF0YQ')).toBe(true);
    expect(looksEncrypted('v1:k1:aXY:dGFn:')).toBe(true); // an empty plaintext
    expect(looksEncrypted('Budi Santoso')).toBe(false);
    expect(looksEncrypted(null)).toBe(false);
    expect(encryptionContext('public', 'uks_visits', 'note')).toBe('uks_visits.note');
    expect(encryptionContext('tppk', 'reports', 'chronology')).toBe('tppk.reports.chronology');
  });
});
