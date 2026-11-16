import { defineConsumer, type Consumer } from '../../../shared/outbox';
import type { ObjectStorage } from '../../../shared/storage';
import { parseStudentImport } from './student-import';

/** Outbox consumers of the academic module; the worker registers them. */
export function academicConsumers(storage: ObjectStorage): Consumer[] {
  return [
    defineConsumer({
      name: 'academic_parse_student_import',
      event: 'student_import.uploaded',
      handle: (tx, event) => parseStudentImport(tx, storage, event.payload.importId),
    }),
  ];
}
