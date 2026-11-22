/** An installment is reminded once, in the last days before it is due (TGH-04). */
export const REMIND_DAYS_BEFORE = 3;
/** Reminders go out from this minute of the school's day, so they arrive in the morning on every timezone. */
export const REMIND_AT_MINUTES = 8 * 60;

/** The due dates that are due for a reminder on `today`: today up to REMIND_DAYS_BEFORE days ahead (a missed day catches up). */
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const remindWindow = (today: string): { from: string; to: string } => ({ from: today, to: addDays(today, REMIND_DAYS_BEFORE) });
