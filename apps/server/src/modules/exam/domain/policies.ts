import { EXAM_CARD_HOLDERS, EXAM_MANAGERS, EXAM_VIEWERS } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** UJN-01: the wakasek and admin set up exam periods and their rule. */
export const canManageExams = anyRole(...EXAM_MANAGERS);
/** Reading periods (and, per rombel, who may sit): those, kepsek, and the wali kelas for their own rombel. */
export const canReadExams = anyRole(...EXAM_VIEWERS);

/** The exam card status: a parent or the student, for their own children only. */
export const canViewMyExams = anyRole(...EXAM_CARD_HOLDERS);
