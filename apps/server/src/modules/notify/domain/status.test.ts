import { describe, expect, it } from 'vitest';
import { nextStatus, parseMetaStatuses } from './status';

describe('notification status', () => {
  it('only moves up: read beats delivered beats failed beats sent', () => {
    expect(nextStatus('queued', { status: 'sent' })).toBe('sent');
    expect(nextStatus('read', { status: 'delivered' })).toBe('read');
    expect(nextStatus('delivered', { status: 'failed' })).toBe('delivered');
    expect(nextStatus('sent', { status: 'failed' })).toBe('failed');
    expect(nextStatus('failed', { status: 'read' })).toBe('read');
  });

  it('reads statuses from a Cloud API webhook and ignores the rest', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1763290800' }, { id: 'wamid.2', status: 'failed', timestamp: '1763290801', errors: [{ code: 131026 }] }] } },
            { value: { messages: [{ id: 'in.1', text: { body: 'halo' } }] } },
            { value: { statuses: [{ id: 'wamid.3', status: 'deleted' }] } },
          ],
        },
      ],
    };
    expect(parseMetaStatuses(body)).toEqual([
      { providerMessageId: 'wamid.1', status: 'delivered', at: new Date(1763290800_000) },
      { providerMessageId: 'wamid.2', status: 'failed', at: new Date(1763290801_000), error: 'wa_131026' },
    ]);
    expect(parseMetaStatuses(null)).toEqual([]);
    expect(parseMetaStatuses({ entry: 'x' })).toEqual([]);
  });
});
