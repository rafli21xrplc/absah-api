import { z } from 'zod';

/** WhatsApp notifications (NTF). */

/** Delivery states. Webhooks can arrive in any order; NOTIFICATION_STATUS_RANK decides the final one. */
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export const NotificationStatus = z.enum(NOTIFICATION_STATUSES).meta({ id: 'NotificationStatus' });
export type NotificationStatus = z.infer<typeof NotificationStatus>;

/**
 * A later status never goes back to an earlier one. failed sits between sent and delivered: a
 * message the phone received cannot become failed, but a sent one can.
 */
export const NOTIFICATION_STATUS_RANK: Record<NotificationStatus, number> = { queued: 0, sent: 1, failed: 2, delivered: 3, read: 4 };

/** Approval of a template by the WhatsApp provider (set by the Absah team). */
export const TEMPLATE_APPROVALS = ['draft', 'pending', 'approved', 'rejected'] as const;
export const TemplateApproval = z.enum(TEMPLATE_APPROVALS).meta({ id: 'TemplateApproval' });
export type TemplateApproval = z.infer<typeof TemplateApproval>;

/** Templates the product sends; rows in message_templates (one per language). */
export const TEMPLATE_CODES = ['absent_marked', 'leave_approved', 'leave_rejected', 'login_otp', 'mbg_count', 'mbg_count_corrected', 'liaison_message', 'mbg_forecast', 'student_sent_home', 'student_picked_up', 'unlisted_pickup', 'tppk_report_received', 'tppk_team_changed', 'pkl_mentor_assigned', 'pkl_checkin_missing'] as const;
export const TemplateCode = z.enum(TEMPLATE_CODES).meta({ id: 'TemplateCode' });
export type TemplateCode = z.infer<typeof TemplateCode>;
