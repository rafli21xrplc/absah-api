import type { ImportSource, StudentImporter } from '../../domain/student-import';
import { DapodikImporter } from './dapodik/dapodik-importer';

export { DapodikImporter } from './dapodik/dapodik-importer';

/** Importer per source; EMIS gets its own parser behind the same interface. */
export function importerFor(source: ImportSource): StudentImporter {
  if (source === 'dapodik') return new DapodikImporter();
  throw new Error(`no importer for ${source} yet`);
}
