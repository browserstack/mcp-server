export const TC_DETAILS_MAX_BATCH = 10;

export const BULK_CREATE_MAX_BATCH = 10;

// Cap scenarios per document (mirrors TCG's former maxScenariosPerDocument=10).
export const MAX_SCENARIOS_PER_DOCUMENT = 10;

export const TCG_TRIGGER_URL = (baseUrl: string) =>
  `${baseUrl}/api/v1/integration/tcg/test-generation/suggest-test-cases`;

export const TCG_POLL_URL = (baseUrl: string) =>
  `${baseUrl}/api/v1/integration/tcg/test-generation/test-cases-polling`;

export const FETCH_DETAILS_URL = (baseUrl: string) =>
  `${baseUrl}/api/v1/integration/tcg/test-generation/fetch-test-case-details`;

export const FORM_FIELDS_URL = (baseUrl: string, projectId: string) =>
  `${baseUrl}/api/v1/projects/${projectId}/form-fields-v2`;

export const BULK_CREATE_URL = (
  baseUrl: string,
  projectId: string,
  folderId: string,
) =>
  `${baseUrl}/api/v1/projects/${projectId}/folder/${folderId}/bulk-test-cases`;
