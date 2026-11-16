/** "ADITYA PRATAMA" -> "Aditya": the only part of a name the kiosk shows. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
