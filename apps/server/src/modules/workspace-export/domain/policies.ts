import { anyRole } from '../../../shared/policy';

/** PLT-11: the data belongs to the school; the school's admin takes it along. Nobody else (not even the kepsek) asks for the whole workspace. */
export const canExportWorkspace = anyRole('admin');
