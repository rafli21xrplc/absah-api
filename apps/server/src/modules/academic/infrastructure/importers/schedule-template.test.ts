import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ImportFormatError } from '../../domain/student-import';
import { buildScheduleTemplate, readScheduleTemplate } from './schedule-template';

const data = {
  lessons: [
    { className: 'VII A', day: 1, period: 1, subject: 'Matematika', teacher: 'Pak Andi' },
    { className: 'VII A', day: 5, period: 2, subject: 'IPA', teacher: null },
  ],
  classes: ['VII A', 'VII B'],
  periods: [{ day: 1, number: 1, startsAt: '07:00', endsAt: '07:40' }],
  subjects: ['IPA', 'Matematika'],
  teachers: ['Pak Andi'],
};

describe('schedule template', () => {
  it('round-trips the current lessons and skips blank rows', async () => {
    const file = await buildScheduleTemplate(data);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Jadwal', 'Rombel', 'Jam Pelajaran', 'Mapel', 'Guru', 'Petunjuk']);
    const sheet = workbook.getWorksheet('Jadwal');
    if (!sheet) throw new Error('no Jadwal sheet');
    sheet.getRow(5).values = ['VII B', 'Selasa', 3, 'Seni', ''];
    const rows = await readScheduleTemplate(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(rows).toEqual([
      { row: 2, className: 'VII A', day: 'Senin', period: '1', subject: 'Matematika', teacher: 'Pak Andi' },
      { row: 3, className: 'VII A', day: 'Jumat', period: '2', subject: 'IPA', teacher: '' },
      { row: 5, className: 'VII B', day: 'Selasa', period: '3', subject: 'Seni', teacher: '' },
    ]);
  });

  it('refuses files that are not the template', async () => {
    await expect(readScheduleTemplate(Buffer.from('nama,kelas'))).rejects.toBeInstanceOf(ImportFormatError);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Jadwal').addRow(['Kelas', 'Hari']);
    await expect(readScheduleTemplate(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow(/Rombel, Hari, Jam ke, Mapel, Guru/);
  });
});
