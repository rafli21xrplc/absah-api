import { MUTABLE_TEMPLATE_CODES, NOTIFICATION_LATE_CUTOFF_MINUTES, type TemplateCode } from '@absah/contracts';
import { OUTSIDE_QUIET_HOURS, type SendWindow } from './messages';

/** A parent's stored choices (ORT-06); undefined = the defaults. */
export interface Preference {
  mutedTypes: readonly string[];
  noLateMessages: boolean;
}

/** Only the types in MUTABLE_TEMPLATE_CODES can be switched off, whatever the row says. */
export function isMuted(pref: Preference | undefined, code: TemplateCode): boolean {
  return !!pref && (MUTABLE_TEMPLATE_CODES as readonly string[]).includes(code) && pref.mutedTypes.includes(code);
}

/**
 * The sending hours for one parent: the message's own window (default outside the quiet hours),
 * ended earlier at the late cutoff when the parent asked for no late messages. A message created
 * after the cutoff waits for the window start (06.00), like one created in the quiet hours.
 */
export function windowFor(base: SendWindow | undefined, pref: Preference | undefined): SendWindow {
  const window = base ?? OUTSIDE_QUIET_HOURS;
  return pref?.noLateMessages ? { start: window.start, end: Math.min(window.end, NOTIFICATION_LATE_CUTOFF_MINUTES) } : window;
}
