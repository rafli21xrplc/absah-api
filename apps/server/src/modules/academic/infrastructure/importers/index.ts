import type { ImportSource, StudentImporter } from '../../domain/student-import';
import { DapodikImporter } from './dapodik/dapodik-importer';
import { EmisImporter } from './emis/emis-importer';

export { DapodikImporter } from './dapodik/dapodik-importer';
export { EmisImporter } from './emis/emis-importer';

/** Importer per source (data.source): Dapodik for schools, EMIS for madrasah. */
export function importerFor(source: ImportSource): StudentImporter {
  return source === 'emis' ? new EmisImporter() : new DapodikImporter();
}
