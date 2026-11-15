// Writes openapi/openapi.json. CI regenerates it and fails if the committed file differs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateOpenApiDocument } from '../src/openapi';

const out = fileURLToPath(new URL('../openapi/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${out}`);
