import {
  CreateLearningGroupRequest,
  GroupIdParam,
  LearningGroup,
  LearningGroupDetail,
  LearningGroupList,
  ReplaceGroupMembersRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { createLearningGroup, getLearningGroup, getLearningGroups, setLearningGroupMembers } from '../application/learning-groups';

/** Learning groups exist only where attendance.learningGroups is on (SMA, SMK by preset). */
export function learningGroupsRouter(auth: Auth): Router {
  const router = Router();
  const guard = [resolveContext(auth, { school: 'required' }), requireCap('attendance.learningGroups')];

  router.get('/learning-groups', ...guard, async (req, res) => {
    sendContract(res, LearningGroupList, await getLearningGroups(getActor(req)));
  });
  router.get('/learning-groups/:groupId', ...guard, async (req, res) => {
    const { groupId } = GroupIdParam.parse(req.params);
    sendContract(res, LearningGroupDetail, await getLearningGroup(getActor(req), groupId));
  });
  router.post('/learning-groups', ...guard, idempotent(), async (req, res) => {
    sendContract(res, LearningGroup, await createLearningGroup(getActor(req), CreateLearningGroupRequest.parse(req.body)));
  });
  router.put('/learning-groups/:groupId/members', ...guard, idempotent(), async (req, res) => {
    const { groupId } = GroupIdParam.parse(req.params);
    const { enrollmentIds } = ReplaceGroupMembersRequest.parse(req.body);
    sendContract(res, LearningGroupDetail, await setLearningGroupMembers(getActor(req), groupId, enrollmentIds));
  });

  return router;
}
