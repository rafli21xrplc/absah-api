import { describe, expect, it } from 'vitest';
import { killSwitches } from './overrides';
import { releaseFlags } from './release';

describe('release flags', () => {
  it('are off by default and a school row beats the global row', () => {
    expect(releaseFlags([])).toEqual({ 'rdm-export-beta': false });
    expect(releaseFlags([{ key: 'rdm-export-beta', value: true, schoolId: null }])['rdm-export-beta']).toBe(true);
    expect(releaseFlags([{ key: 'rdm-export-beta', value: true, schoolId: 's1' }, { key: 'rdm-export-beta', value: false, schoolId: null }])['rdm-export-beta']).toBe(true);
    expect(releaseFlags([{ key: 'rdm-export-beta', value: 'yes', schoolId: 's1' }])['rdm-export-beta']).toBe(false);
  });

  it('are not reported as unknown kill switches', () => {
    const invalid: string[] = [];
    killSwitches([{ key: 'rdm-export-beta', value: true, schoolId: null }], (key) => invalid.push(key));
    expect(invalid).toEqual([]);
  });
});
