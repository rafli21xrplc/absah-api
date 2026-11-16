import { anyRole } from '../../../shared/policy';

/** School profile and capability settings (PLT-07, AKD-08). */
export const canManageSchoolSettings = anyRole('admin');

/** Student data imports and the student/rombel registry (AKD-01 to AKD-03). */
export const canManageStudentData = anyRole('admin', 'operator');

/** Reading the whole student registry (wali kelas get their own rombel in a later prompt). */
export const canReadStudentData = anyRole('admin', 'operator', 'kepsek', 'wakasek');

/** Timetable, jam pelajaran, subjects and wali kelas (kurikulum: wakasek). */
export const canManageSchedule = anyRole('admin', 'operator', 'wakasek');
/** Reading timetables: school staff who teach or lead. */
export const canReadSchedule = anyRole('admin', 'operator', 'kepsek', 'wakasek', 'wali_kelas', 'guru', 'piket');
