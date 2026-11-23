// Public API of the gate module (GRB). Other modules import only from here.
export { gateRouter } from './http/gate-admin';
export { kioskRouter } from './http/kiosk';
export { kioskCors } from './http/kiosk-cors';
export { createLoadFixture } from './application/load-fixture';
