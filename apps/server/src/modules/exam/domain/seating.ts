export interface Existing {
  roomId: string;
  seatNo: number;
}
export interface SeatingPlan {
  add: { enrollmentId: string; seatNo: number }[];
  move: { enrollmentId: string; seatNo: number }[];
  unchanged: number;
  /** How many sit in the room once the plan is applied. */
  seatedAfter: number;
}

/**
 * Places students in a room: those in no room get the lowest free numbers, those in another room of the period move
 * (and take the next free numbers here), those already here stay. Order of the input is the order of the numbers.
 */
export function planSeating(input: { roomId: string; occupied: number[]; existing: Map<string, Existing>; enrollmentIds: string[] }): SeatingPlan {
  const taken = new Set(input.occupied);
  let next = 1;
  const nextFree = () => {
    while (taken.has(next)) next++;
    taken.add(next);
    return next;
  };
  const plan: SeatingPlan = { add: [], move: [], unchanged: 0, seatedAfter: input.occupied.length };
  for (const enrollmentId of new Set(input.enrollmentIds)) {
    const here = input.existing.get(enrollmentId);
    if (here?.roomId === input.roomId) plan.unchanged++;
    else if (here) plan.move.push({ enrollmentId, seatNo: nextFree() });
    else plan.add.push({ enrollmentId, seatNo: nextFree() });
  }
  plan.seatedAfter += plan.add.length + plan.move.length;
  return plan;
}
