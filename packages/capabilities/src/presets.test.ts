import { describe, expect, it } from 'vitest';
import { CAPABILITIES, isBoolCapability, isCapabilityKey, parseCapabilityValue } from './catalog';
import { LEVELS } from './levels';
import { LEVEL_PRESETS, MADRASAH_OVERLAY, presetCapabilities, resolveCapabilities } from './presets';

describe('resolveCapabilities: 4 levels x madrasah', () => {
  for (const level of LEVELS) {
    for (const isMadrasah of [false, true]) {
      it(`${level}${isMadrasah ? ' + madrasah' : ''}`, () => {
        expect(resolveCapabilities({ level, isMadrasah })).toMatchSnapshot();
      });
    }
  }
});

describe('resolution layers', () => {
  it('lets a school override beat the preset', () => {
    const caps = resolveCapabilities({ level: 'sd', isMadrasah: false, overrides: { 'gate.pickup': false } });
    expect(presetCapabilities('sd', false)['gate.pickup']).toBe(true);
    expect(caps['gate.pickup']).toBe(false);
  });

  it('lets an override beat the madrasah overlay', () => {
    const caps = resolveCapabilities({ level: 'sma', isMadrasah: true, overrides: { 'data.source': 'dapodik' } });
    expect(caps['data.source']).toBe('dapodik');
  });

  it('lets a kill switch beat a school override', () => {
    const caps = resolveCapabilities({
      level: 'smk',
      isMadrasah: false,
      overrides: { 'mbg.enabled': true },
      killSwitches: { 'mbg.enabled': false, 'pkl.enabled': false },
    });
    expect(caps['mbg.enabled']).toBe(false);
    expect(caps['pkl.enabled']).toBe(false);
    expect(caps['pkl.tracer']).toBe(true);
  });

  it('returns every catalog key and never mutates the presets', () => {
    const caps = resolveCapabilities({ level: 'sd', isMadrasah: true, overrides: { 'gate.pickup': false } });
    expect(Object.keys(caps).sort()).toEqual(Object.keys(CAPABILITIES).sort());
    expect(LEVEL_PRESETS.sd['gate.pickup']).toBe(true);
    expect(MADRASAH_OVERLAY['data.source']).toBe('emis');
  });
});

describe('catalog checks', () => {
  it('validates values by kind', () => {
    expect(parseCapabilityValue('gate.pickup', true)).toEqual({ ok: true, value: true });
    expect(parseCapabilityValue('gate.pickup', 'true').ok).toBe(false);
    expect(parseCapabilityValue('attendance.mode', 'daily')).toEqual({ ok: true, value: 'daily' });
    expect(parseCapabilityValue('attendance.mode', 'weekly').ok).toBe(false);
    expect(parseCapabilityValue('attendance.mode', true).ok).toBe(false);
  });

  it('knows its keys', () => {
    expect(isCapabilityKey('pkl.enabled')).toBe(true);
    expect(isCapabilityKey('toString')).toBe(false);
    expect(isCapabilityKey('pkl')).toBe(false);
    expect(isBoolCapability('pkl.enabled')).toBe(true);
    expect(isBoolCapability('attendance.mode')).toBe(false);
  });

  it('keeps every enum default inside its values', () => {
    for (const [key, def] of Object.entries(CAPABILITIES)) {
      if (def.kind === 'enum') expect(def.values, key).toContain(def.default);
    }
  });
});
