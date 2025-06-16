import { DOMAINS } from "../../../lib/domains.js";

export const TCG_TRIGGER_URL = `${DOMAINS.TEST_MANAGEMENT}/api/v1/integration/tcg/test-generation/suggest-test-cases`;
export const TCG_POLL_URL = `${DOMAINS.TEST_MANAGEMENT}/api/v1/integration/tcg/test-generation/test-cases-polling`;
export const FETCH_DETAILS_URL = `${DOMAINS.TEST_MANAGEMENT}/api/v1/integration/tcg/test-generation/fetch-test-case-details`;
export const FORM_FIELDS_URL = (projectId: string): string =>
  `${DOMAINS.TEST_MANAGEMENT}/api/v1/projects/${projectId}/form-fields-v2`;
export const BULK_CREATE_URL = (projectId: string, folderId: string): string =>
  `${DOMAINS.TEST_MANAGEMENT}/api/v1/projects/${projectId}/folder/${folderId}/bulk-test-cases`;
