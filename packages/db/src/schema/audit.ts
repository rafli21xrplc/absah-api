import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

/**
 * Append-only audit trail (PLT-04). Written through shared/audit.ts from use cases; readable only
 * by active admins of the school; no UPDATE/DELETE for the app role (migration 0005).
 * actor_user_id has no FK on purpose: entries outlive deleted accounts.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipHash: text('ip_hash'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_school_id_created_at_idx').on(t.schoolId, t.createdAt.desc()),
    index('audit_logs_school_id_entity_idx').on(t.schoolId, t.entity, t.entityId),
  ],
);
