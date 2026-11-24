export interface BoardStudent {
  className: string;
  arrived: boolean;
  late: boolean;
  excused: boolean;
}

export interface BoardRow {
  className: string;
  students: number;
  onTime: number;
  late: number;
  notArrived: number;
  excused: number;
}

/** Counts per rombel in the order given (the repo sorts by name); `excused` only counts students who are not in yet. */
export function boardByClass(students: BoardStudent[]): { classes: BoardRow[]; totals: Omit<BoardRow, 'className'> } {
  const byClass = new Map<string, BoardRow>();
  const totals = { students: 0, onTime: 0, late: 0, notArrived: 0, excused: 0 };
  for (const s of students) {
    const row = byClass.get(s.className) ?? { className: s.className, students: 0, onTime: 0, late: 0, notArrived: 0, excused: 0 };
    byClass.set(s.className, row);
    const add = (key: 'students' | 'onTime' | 'late' | 'notArrived' | 'excused') => {
      row[key] += 1;
      totals[key] += 1;
    };
    add('students');
    if (!s.arrived) {
      add('notArrived');
      if (s.excused) add('excused');
    } else add(s.late ? 'late' : 'onTime');
  }
  return { classes: [...byClass.values()], totals };
}
