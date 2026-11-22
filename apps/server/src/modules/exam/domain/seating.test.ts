import { describe, expect, it } from 'vitest';
import { planSeating } from './seating';

const room = 'r1';

describe('planSeating', () => {
  it('gives the lowest free numbers, skipping the ones in use, in the order given', () => {
    const plan = planSeating({ roomId: room, occupied: [1, 3], existing: new Map(), enrollmentIds: ['a', 'b', 'c'] });
    expect(plan.add).toEqual([{ enrollmentId: 'a', seatNo: 2 }, { enrollmentId: 'b', seatNo: 4 }, { enrollmentId: 'c', seatNo: 5 }]);
    expect(plan.seatedAfter).toBe(5);
  });

  it('leaves those already here, and moves those from another room to new numbers here', () => {
    const plan = planSeating({
      roomId: room,
      occupied: [1],
      existing: new Map([['a', { roomId: room, seatNo: 1 }], ['b', { roomId: 'r2', seatNo: 7 }]]),
      enrollmentIds: ['a', 'b', 'c'],
    });
    expect(plan).toEqual({ add: [{ enrollmentId: 'c', seatNo: 3 }], move: [{ enrollmentId: 'b', seatNo: 2 }], unchanged: 1, seatedAfter: 3 });
  });

  it('counts a student named twice once', () => {
    const plan = planSeating({ roomId: room, occupied: [], existing: new Map(), enrollmentIds: ['a', 'a'] });
    expect(plan.add).toHaveLength(1);
  });
});
