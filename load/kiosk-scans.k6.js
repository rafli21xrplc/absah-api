// k6 load test for POST /api/v1/kiosk/scans (GRB, phase 3 exit: 900 scans in 20 minutes, no
// duplicates). Run against dev/staging only:
//   pnpm --filter @absah/server gate:load-fixture --school <id> > load/fixture.json
//   k6 run -e BASE_URL=http://localhost:4000 -e FIXTURE=fixture.json load/kiosk-scans.k6.js
// Each iteration is one kiosk scan (batch of 1, the worst case). Tokens are made like the
// holder's phone does (@absah/contracts gate/card-token.ts).
import { check } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';

const fixture = JSON.parse(open(__ENV.FIXTURE || 'fixture.json'));
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  scenarios: {
    morning: { executor: 'constant-arrival-rate', rate: 45, timeUnit: '1m', duration: '20m', preAllocatedVUs: 5, maxVUs: 20 },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1000'], checks: ['rate>0.99'] },
};

const uuidBytes = (uuid) => uuid.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16));
const b64urlBytes = (text) => new Uint8Array(encoding.b64decode(text, 'rawurl'));
const toB64url = (bytes) => encoding.b64encode(new Uint8Array(bytes).buffer, 'rawurl');
const uuidv4 = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

function token(card, ms) {
  const window = Math.floor(ms / 1000 / 30);
  const mac = new Uint8Array(crypto.hmac('sha256', b64urlBytes(card.deviceKey).buffer, `${card.cardId}:${window}`, 'binary')).slice(0, 16);
  return ['A1', toB64url([...uuidBytes(card.cardId), ...uuidBytes(card.deviceId)]), window.toString(36), toB64url(mac)].join('.');
}

export default function () {
  const card = fixture.cards[__ITER % fixture.cards.length];
  const now = Date.now();
  const body = JSON.stringify({ scans: [{ clientEventId: uuidv4(), token: token(card, now), scannedAt: new Date(now).toISOString() }] });
  const res = http.post(`${BASE_URL}/api/v1/kiosk/scans`, body, {
    headers: { 'Content-Type': 'application/json', Authorization: `Kiosk ${fixture.kioskToken}`, 'Idempotency-Key': uuidv4() },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'accepted or duplicate': (r) => r.status === 200 && ['accepted', 'duplicate'].includes(r.json('results.0.result')),
  });
}
