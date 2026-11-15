/**
 * Field names whose values are personal data or secrets. Used by the logger redactor and by the
 * audit diff sanitiser, so both stay in step. Compared case-insensitively by the sanitiser.
 */
export const SENSITIVE_KEYS = [
  'name', 'fullName', 'firstName', 'lastName', 'nama',
  'phone', 'phoneNumber', 'nomorHp', 'whatsapp',
  'email', 'nisn', 'nik', 'nip', 'address', 'alamat', 'birthDate',
  'password', 'otp', 'token', 'secret', 'chronology', 'note', 'notes',
  'ip', 'ipAddress',
] as const;
