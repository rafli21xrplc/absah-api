import { JournalQuery, JournalResponse } from '@absah/contracts';
import { Router } from 'express';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { exportJournal, getJournal } from '../application/journal';

/** Jurnal mengajar (PRS-09): topics teachers write when filling a session, read per month. */
export function journalRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/teaching-journal', school, async (req, res) => {
    sendContract(res, JournalResponse, await getJournal(getActor(req), JournalQuery.parse(req.query)));
  });

  router.get('/teaching-journal/export.xlsx', school, async (req, res) => {
    const { file, fileName } = await exportJournal(getActor(req), JournalQuery.parse(req.query));
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      })
      .send(file);
  });

  return router;
}
