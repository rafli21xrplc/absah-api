// OpenAPI document built from the Zod contracts. Kept out of index.ts so web/kiosk
// bundles that import contracts do not pull in the generator.
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  SchoolCapabilitiesResponse,
  SchoolProfileResponse,
  SchoolSetupResponse,
  SetupStepParam,
  UpdateSetupStepRequest,
  UpdateSchoolCapabilitiesRequest,
  UpdateSchoolProfileRequest,
} from './academic/school-settings';
import { ErrorBody } from './common';
import { MeContextResponse, MembershipIdParam, SchoolMember, SchoolMembersResponse, UpdateMembershipStatusRequest } from './platform/context';
import { HealthResponse } from './platform/health';

export const API_BASE_PATH = '/api/v1';

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();
  // Component names come from each schema's .meta({ id }).
  const errorBody = ErrorBody;
  const healthResponse = HealthResponse;

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/health`,
    tags: ['platform'],
    summary: 'Liveness check',
    responses: {
      200: { description: 'API is up', content: { 'application/json': { schema: healthResponse } } },
      500: { description: 'Unexpected error', content: { 'application/json': { schema: errorBody } } },
    },
  });

  const errors = (...codes: number[]) =>
    Object.fromEntries(
      codes.map((code) => [code, { description: ERROR_DESCRIPTIONS[code] ?? 'Error', content: { 'application/json': { schema: errorBody } } }]),
    );
  const schoolHeader = {
    name: 'X-School-Id',
    in: 'header' as const,
    description: 'Active school (workspace). Must be a school where the user has an active membership.',
    schema: { type: 'string' as const, format: 'uuid' },
  };
  const idempotencyHeader = {
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: true,
    description: 'One key per user action, reused on retry. Same key with a different body gives 422.',
    schema: { type: 'string' as const, pattern: '^[A-Za-z0-9_\\-:.]{8,128}$' },
  };

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/me/context`,
    tags: ['platform'],
    summary: 'Current user, their schools, and roles in the active school',
    description: 'X-School-Id is optional here. Admin/operator without TOTP get 403 TWO_FACTOR_REQUIRED when a school is selected.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: false }],
    responses: {
      200: { description: 'Context', content: { 'application/json': { schema: MeContextResponse } } },
      ...errors(400, 401, 403),
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/members`,
    tags: ['platform'],
    summary: 'Members of the active school (admin, operator, kepsek, wakasek)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Members', content: { 'application/json': { schema: SchoolMembersResponse } } },
      ...errors(400, 401, 403),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${API_BASE_PATH}/school/members/{membershipId}`,
    tags: ['platform'],
    summary: 'Activate or suspend a membership (admin)',
    description: 'Idempotent: send Idempotency-Key. Admins cannot change their own membership.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
    request: {
      params: MembershipIdParam,
      body: { content: { 'application/json': { schema: UpdateMembershipStatusRequest } } },
    },
    responses: {
      200: {
        description: 'Updated membership. Replays carry Idempotent-Replayed: true.',
        content: { 'application/json': { schema: SchoolMember } },
      },
      ...errors(400, 401, 403, 404, 409, 422),
    },
  });

  const adminWrite = (summary: string, path: string, method: 'patch' | 'put', body: typeof UpdateSchoolProfileRequest | typeof UpdateSchoolCapabilitiesRequest, response: typeof SchoolProfileResponse | typeof SchoolCapabilitiesResponse) =>
    registry.registerPath({
      method,
      path: `${API_BASE_PATH}${path}`,
      tags: ['academic'],
      summary,
      description: 'Admin only. Idempotent: send Idempotency-Key. attendance.mode changes apply from tomorrow (school timezone).',
      security: [{ session: [] }],
      parameters: [{ ...schoolHeader, required: true }, idempotencyHeader],
      request: { body: { content: { 'application/json': { schema: body } } } },
      responses: {
        200: { description: 'Saved', content: { 'application/json': { schema: response } } },
        ...errors(400, 401, 403, 409, 422),
      },
    });
  adminWrite('Change the school level / madrasah profile', '/school/profile', 'patch', UpdateSchoolProfileRequest, SchoolProfileResponse);
  adminWrite('Override capabilities of the school', '/school/capabilities', 'put', UpdateSchoolCapabilitiesRequest, SchoolCapabilitiesResponse);
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/capabilities`,
    tags: ['academic'],
    summary: 'Capability settings of the active school (admin)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: {
      200: { description: 'Settings', content: { 'application/json': { schema: SchoolCapabilitiesResponse } } },
      ...errors(400, 401, 403),
    },
  });

  const setupResponse = {
    200: { description: 'Wizard progress', content: { 'application/json': { schema: SchoolSetupResponse } } },
  };
  registry.registerPath({
    method: 'get',
    path: `${API_BASE_PATH}/school/setup`,
    tags: ['academic'],
    summary: 'Setup wizard progress of the active school (admin)',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { ...setupResponse, ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'put',
    path: `${API_BASE_PATH}/school/setup/steps/{step}`,
    tags: ['academic'],
    summary: 'Mark a wizard step done or skipped (admin)',
    description: 'Naturally idempotent. profile and level cannot be skipped.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    request: {
      params: SetupStepParam,
      body: { content: { 'application/json': { schema: UpdateSetupStepRequest } } },
    },
    responses: { ...setupResponse, ...errors(400, 401, 403) },
  });
  registry.registerPath({
    method: 'post',
    path: `${API_BASE_PATH}/school/setup/complete`,
    tags: ['academic'],
    summary: 'Finish the setup wizard (admin)',
    description: 'Naturally idempotent (keeps the first completion time). 409 until profile and level are done.',
    security: [{ session: [] }],
    parameters: [{ ...schoolHeader, required: true }],
    responses: { ...setupResponse, ...errors(400, 401, 403, 409) },
  });

  registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Session cookie from /api/auth/* (Better Auth).',
  });

  return registry;
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed (VALIDATION_FAILED)',
  401: 'No session (UNAUTHENTICATED)',
  403: 'Not a member, wrong role (FORBIDDEN) or 2FA missing (TWO_FACTOR_REQUIRED)',
  404: 'Not found (NOT_FOUND)',
  409: 'Same Idempotency-Key still running (IDEMPOTENCY_IN_PROGRESS) or state conflict (CONFLICT)',
  422: 'Idempotency-Key reused with a different request (IDEMPOTENCY_KEY_REUSED)',
};

export function generateOpenApiDocument(version = '0.0.0') {
  const generator = new OpenApiGeneratorV31(buildRegistry().definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Absah API', version },
    servers: [{ url: '/' }],
  });
}
