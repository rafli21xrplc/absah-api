// Public API of the academic module (AKD). Other modules import only from here.
export { academicRouter } from './http/school-settings';
export { importsRouter } from './http/imports';
export { academicConsumers } from './application/student-import-consumers';
export { IMPORT_RETENTION_QUEUE, importRetentionHandler, purgeStaleImports } from './jobs/import-retention';
export { registryRouter } from './http/registry';
export { scheduleRouter } from './http/schedule';
export { learningGroupsRouter } from './http/learning-groups';
