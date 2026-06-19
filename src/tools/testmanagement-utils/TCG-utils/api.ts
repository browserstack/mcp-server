import { apiClient } from "../../../lib/apiClient.js";
import {
  TCG_TRIGGER_URL,
  TCG_POLL_URL,
  FETCH_DETAILS_URL,
  FORM_FIELDS_URL,
  BULK_CREATE_URL,
  TC_DETAILS_MAX_BATCH,
  BULK_CREATE_MAX_BATCH,
  MAX_SCENARIOS_PER_DOCUMENT,
} from "./config.js";
import {
  DefaultFieldMaps,
  Scenario,
  CreateTestCasesFromFileArgs,
} from "./types.js";
import {
  createTestCasePayload,
  chunkArray,
  canAcceptScenario,
} from "./helpers.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { getTMBaseURL } from "../../../lib/tm-base-url.js";
import logger from "../../../logger.js";

const POLL_INTERVAL_MS = 10000;
const MAX_POLL_DURATION_MS = 8 * 60 * 1000;

/**
 * Fetch default and custom form fields for a project.
 */
export async function fetchFormFields(
  projectId: string,
  config: BrowserStackConfig,
): Promise<{ default_fields: any; custom_fields: any }> {
  const tmBaseUrl = await getTMBaseURL(config);
  const res = await apiClient.get({
    url: FORM_FIELDS_URL(tmBaseUrl, projectId),
    headers: {
      "API-TOKEN": getBrowserStackAuth(config),
    },
  });
  return res.data;
}

/**
 * Resolve a default-field input (priority/case_type) to the form's display or
 * internal name, matching case-insensitively. Returns undefined if no match.
 */
export function normalizeDefaultFieldValue(
  fieldValues: Array<{
    internal_name?: string | null;
    name?: string;
    value: any;
  }>,
  input: string,
  emit: "name" | "internal_name",
): string | undefined {
  const normalized = input.toLowerCase().trim();
  const match = fieldValues.find(
    (v) =>
      (v.internal_name ?? "").toLowerCase() === normalized ||
      (v.name ?? "").toLowerCase() === normalized,
  );
  if (!match) return undefined;
  if (emit === "name") return match.name;
  return match.internal_name ?? match.name;
}

/**
 * Trigger AI-based test case generation for a document.
 */
export async function triggerTestCaseGeneration(
  document: string,
  documentId: number,
  folderId: string,
  projectId: string,
  source: string,
  config: BrowserStackConfig,
): Promise<string> {
  const tmBaseUrl = await getTMBaseURL(config);
  const res = await apiClient.post({
    url: TCG_TRIGGER_URL(tmBaseUrl),
    headers: {
      "API-TOKEN": getBrowserStackAuth(config),
      "Content-Type": "application/json",
      "request-source": source,
    },
    body: {
      document,
      documentId,
      folderId,
      projectId,
      source,
      webhookUrl: `${tmBaseUrl}/api/v1/projects/${projectId}/folder/${folderId}/webhooks/tcg`,
    },
  });
  if (res.status !== 200) {
    throw new Error(`Trigger failed: ${res.statusText || res.status}`);
  }
  return res.data["x-bstack-traceRequestId"];
}

/**
 * Initiate a fetch for test-case details; returns the traceRequestId for polling.
 */
export async function fetchTestCaseDetails(
  documentId: number,
  folderId: string,
  projectId: string,
  testCaseIds: string[],
  source: string,
  config: BrowserStackConfig,
): Promise<string> {
  if (testCaseIds.length === 0) {
    throw new Error("No testCaseIds provided to fetchTestCaseDetails");
  }
  const tmBaseUrl = await getTMBaseURL(config);
  const res = await apiClient.post({
    url: FETCH_DETAILS_URL(tmBaseUrl),
    headers: {
      "API-TOKEN": getBrowserStackAuth(config),
      "request-source": source,
      "Content-Type": "application/json",
    },
    body: {
      document_id: documentId,
      folder_id: folderId,
      project_id: projectId,
      test_case_ids: testCaseIds,
    },
  });
  if (res.data.data.success !== true) {
    throw new Error(`Fetch details failed: ${res.data.data.message}`);
  }
  return res.data.request_trace_id;
}

/**
 * Poll for a given traceRequestId until all test-case details are returned.
 */
export async function pollTestCaseDetails(
  traceRequestId: string,
  config: BrowserStackConfig,
  deadline: number = Date.now() + MAX_POLL_DURATION_MS,
): Promise<Record<string, any>> {
  const detailMap: Record<string, any> = {};
  let done = false;
  const tmBaseUrl = await getTMBaseURL(config);
  const TCG_POLL_URL_VALUE = TCG_POLL_URL(tmBaseUrl);

  while (!done) {
    // add a bit of jitter to avoid synchronized polling storms
    await new Promise((r) =>
      setTimeout(r, POLL_INTERVAL_MS + Math.random() * 5000),
    );

    // Give up before the backend key TTL expires; return whatever we collected.
    if (Date.now() > deadline) break;

    const poll = await apiClient.post({
      url: `${TCG_POLL_URL_VALUE}?x-bstack-traceRequestId=${encodeURIComponent(traceRequestId)}`,
      headers: {
        "API-TOKEN": getBrowserStackAuth(config),
      },
      body: {},
      // Don't throw on a non-2xx: an expired request key returns 400
      // ("Request ids does not exists") and simply means there is nothing more
      // to fetch — stop gracefully instead of failing the whole run.
      raise_error: false,
    });

    if (poll.status !== 200 || !poll.data?.data?.success) {
      break;
    }

    for (const msg of poll.data.data.message) {
      if (msg.type === "termination") {
        done = true;
      }
      if (msg.type === "testcase_details") {
        for (const test of msg.data.testcase_details) {
          detailMap[test.id] = {
            steps: test.steps,
            preconditions: test.preconditions,
          };
        }
      }
    }
  }

  return detailMap;
}

/**
 * Poll for scenarios & testcases, trigger detail fetches, then poll all details in parallel.
 */
export async function pollScenariosTestDetails(
  args: CreateTestCasesFromFileArgs,
  traceId: string,
  context: any,
  documentId: number,
  source: string,
  config: BrowserStackConfig,
): Promise<Record<string, Scenario>> {
  const { folderId, projectReferenceId } = args;
  const scenariosMap: Record<string, Scenario> = {};
  const detailPromises: Promise<Record<string, any>>[] = [];
  let iteratorCount = 0;
  const tmBaseUrl = await getTMBaseURL(config);
  const TCG_POLL_URL_VALUE = TCG_POLL_URL(tmBaseUrl);
  const deadline = Date.now() + MAX_POLL_DURATION_MS;

  // Promisify interval-style polling using a wrapper
  await new Promise<void>((resolve, reject) => {
    let stopped = false;

    const pollOnce = async () => {
      if (stopped) return;
      try {
        const poll = await apiClient.post({
          url: `${TCG_POLL_URL_VALUE}?x-bstack-traceRequestId=${encodeURIComponent(traceId)}`,
          headers: {
            "API-TOKEN": getBrowserStackAuth(config),
          },
          body: {},
          raise_error: false,
        });

        if (poll.status !== 200) {
          stopped = true;
          if (Object.keys(scenariosMap).length > 0) {
            resolve();
          } else {
            reject(
              new Error(
                `Polling error: ${poll.status} ${typeof poll.data === "string" ? poll.data : JSON.stringify(poll.data)}`,
              ),
            );
          }
          return;
        }

        let terminated = false;
        for (const msg of poll.data.data.message) {
          if (msg.type === "scenario") {
            msg.data.scenarios.forEach((sc: any) => {
              if (
                canAcceptScenario(
                  scenariosMap,
                  sc.id,
                  MAX_SCENARIOS_PER_DOCUMENT,
                )
              ) {
                scenariosMap[sc.id] ||= {
                  id: sc.id,
                  name: sc.name,
                  testcases: [],
                };
              }
            });
            const count = Object.keys(scenariosMap).length;
            await context.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken: context._meta?.progressToken ?? traceId,
                progress: count,
                total: count,
                message: `Generated ${count} scenarios`,
              },
            });
          }

          if (msg.type === "testcase") {
            const sc = msg.data.scenario;
            if (
              sc &&
              canAcceptScenario(scenariosMap, sc.id, MAX_SCENARIOS_PER_DOCUMENT)
            ) {
              const array = Array.isArray(msg.data.testcases)
                ? msg.data.testcases
                : msg.data.testcases
                  ? [msg.data.testcases]
                  : [];
              const ids: string[] = array.map(
                (tc: any) => tc.id || tc.test_case_id,
              );

              for (const idChunk of chunkArray(ids, TC_DETAILS_MAX_BATCH)) {
                const reqId = await fetchTestCaseDetails(
                  documentId,
                  folderId,
                  projectReferenceId,
                  idChunk,
                  source,
                  config,
                );
                detailPromises.push(
                  pollTestCaseDetails(reqId, config, deadline),
                );
              }

              scenariosMap[sc.id] ||= {
                id: sc.id,
                name: sc.name,
                testcases: [],
                traceId,
              };
              scenariosMap[sc.id].testcases.push(...array);
              iteratorCount++;
              const total = Object.keys(scenariosMap).length;
              await context.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken: context._meta?.progressToken ?? traceId,
                  progress: iteratorCount,
                  total,
                  message: `Generated ${array.length} test cases for scenario ${iteratorCount} out of ${total}`,
                },
              });
            }
          }

          if (msg.type === "termination") {
            terminated = true;
          }
        }

        if (terminated || Date.now() > deadline) {
          stopped = true;
          logger.info(
            `TCG scenario poll stopped (${terminated ? "termination received" : "max duration reached"}); ${Object.keys(scenariosMap).length} scenarios, ${detailPromises.length} detail fetches`,
          );
          resolve();
          return;
        }
        setTimeout(pollOnce, POLL_INTERVAL_MS);
      } catch (err) {
        stopped = true;
        reject(err);
      }
    };
    setTimeout(pollOnce, POLL_INTERVAL_MS);
  });

  const detailsList = await Promise.allSettled(detailPromises);
  const rejectedDetails = detailsList.filter(
    (r) => r.status === "rejected",
  ).length;
  if (rejectedDetails > 0) {
    logger.info(
      `TCG detail fetches: ${detailsList.length - rejectedDetails}/${detailsList.length} succeeded, ${rejectedDetails} failed (degrading gracefully)`,
    );
  }
  const allDetails = detailsList.reduce<Record<string, any>>(
    (acc, result) =>
      result.status === "fulfilled" ? { ...acc, ...result.value } : acc,
    {},
  );

  // attach the fetched detail objects back to each testcase
  for (const scenario of Object.values(scenariosMap)) {
    scenario.testcases = scenario.testcases.map((tc: any) => ({
      ...tc,
      ...(allDetails[tc.id || tc.test_case_id] ?? {}),
    }));
  }

  return scenariosMap;
}

/**
 * Bulk-create generated test cases in BrowserStack.
 */
export async function bulkCreateTestCases(
  scenariosMap: Record<string, Scenario>,
  projectId: string,
  folderId: string,
  fieldMaps: DefaultFieldMaps,
  booleanFieldId: number | undefined,
  traceId: string,
  context: any,
  documentId: number,
  config: BrowserStackConfig,
): Promise<string> {
  const total = Object.keys(scenariosMap).length;
  let doneCount = 0;
  let testCaseCount = 0;
  const failedScenarios: string[] = [];
  const tmBaseUrl = await getTMBaseURL(config);
  const BULK_CREATE_URL_VALUE = BULK_CREATE_URL(tmBaseUrl, projectId, folderId);

  for (const { id, testcases } of Object.values(scenariosMap)) {
    if (testcases.length === 0) continue;

    const batches = chunkArray(testcases, BULK_CREATE_MAX_BATCH);
    let createdInScenario = 0;
    let scenarioFailed = false;

    for (const batch of batches) {
      const payload = {
        test_cases: batch.map((tc) =>
          createTestCasePayload(
            tc,
            id,
            folderId,
            fieldMaps,
            documentId,
            booleanFieldId,
            traceId,
          ),
        ),
      };

      try {
        await apiClient.post({
          url: BULK_CREATE_URL_VALUE,
          headers: {
            "API-TOKEN": getBrowserStackAuth(config),
            "Content-Type": "application/json",
          },
          body: payload,
        });
        createdInScenario += batch.length;
      } catch (error) {
        scenarioFailed = true;
        await context.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken: context._meta?.progressToken ?? traceId,
            message: `Creation failed for scenario ${id}: ${error instanceof Error ? error.message : "Unknown error"}`,
            total,
            progress: doneCount,
          },
        });
      }
    }

    testCaseCount += createdInScenario;
    if (scenarioFailed) {
      failedScenarios.push(id);
    }
    if (createdInScenario > 0) {
      doneCount++;
      await context.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: context._meta?.progressToken ?? "bulk-create",
          message: `Saving and creating test cases...`,
          total,
          progress: doneCount,
        },
      });
    }
  }
  let resultString = `Total of ${testCaseCount} test cases created in ${doneCount} of ${total} scenarios.`;
  if (failedScenarios.length > 0) {
    resultString += ` Failed to create test cases for ${failedScenarios.length} scenario(s): ${failedScenarios.join(", ")}.`;
  }
  return resultString;
}

export async function projectIdentifierToId(
  projectId: string,
  config: BrowserStackConfig,
): Promise<string> {
  const tmBaseUrl = await getTMBaseURL(config);
  const url = `${tmBaseUrl}/api/v1/projects/?q=${projectId}`;

  const response = await apiClient.get({
    url,
    headers: {
      "API-TOKEN": getBrowserStackAuth(config),
      accept: "application/json, text/plain, */*",
    },
  });
  if (response.data.success !== true) {
    throw new Error(
      `Failed to fetch project ID: ${response.statusText || response.status}`,
    );
  }
  for (const project of response.data.projects) {
    if (project.identifier === projectId) {
      return project.id;
    }
  }
  throw new Error(`Project with identifier ${projectId} not found.`);
}

export async function testCaseIdentifierToDetails(
  projectId: string,
  testCaseIdentifier: string,
  config: BrowserStackConfig,
): Promise<{ testCaseId: string; folderId: string }> {
  const tmBaseUrl = await getTMBaseURL(config);
  const url = `${tmBaseUrl}/api/v1/projects/${projectId}/test-cases/search?q[query]=${testCaseIdentifier}`;

  const response = await apiClient.get({
    url,
    headers: {
      "API-TOKEN": getBrowserStackAuth(config),
      accept: "application/json, text/plain, */*",
    },
  });

  if (response.data.success !== true) {
    throw new Error(
      `Failed to fetch test case details: ${response.statusText || response.status}`,
    );
  }

  // Check if test_cases array exists and has items
  if (
    !response.data.test_cases ||
    !Array.isArray(response.data.test_cases) ||
    response.data.test_cases.length === 0
  ) {
    throw new Error(
      `No test cases found in response for identifier ${testCaseIdentifier}`,
    );
  }

  for (const testCase of response.data.test_cases) {
    if (testCase.identifier === testCaseIdentifier) {
      // Extract folder ID from the links.folder URL
      // URL format: "/api/v1/projects/1930314/folder/10193436/test-cases"
      let folderId = "";
      if (testCase.links && testCase.links.folder) {
        const folderMatch = testCase.links.folder.match(/\/folder\/(\d+)\//);
        if (folderMatch && folderMatch[1]) {
          folderId = folderMatch[1];
        }
      }

      if (!folderId) {
        throw new Error(
          `Could not extract folder ID for test case ${testCaseIdentifier}`,
        );
      }

      return {
        testCaseId: testCase.id.toString(),
        folderId: folderId,
      };
    }
  }

  throw new Error(`Test case with identifier ${testCaseIdentifier} not found.`);
}
