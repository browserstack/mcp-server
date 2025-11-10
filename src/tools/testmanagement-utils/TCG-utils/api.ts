import { apiClient } from "../../../lib/apiClient.js";
import {
  TCG_TRIGGER_URL,
  TCG_POLL_URL,
  FETCH_DETAILS_URL,
  FORM_FIELDS_URL,
  BULK_CREATE_URL,
} from "./config.js";
import {
  DefaultFieldMaps,
  Scenario,
  CreateTestCasesFromFileArgs,
} from "./types.js";
import { createTestCasePayload } from "./helpers.js";
import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { getTMBaseURL } from "../../../lib/tm-base-url.js";

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
): Promise<Record<string, any>> {
  const detailMap: Record<string, any> = {};
  let done = false;
  const tmBaseUrl = await getTMBaseURL(config);
  const TCG_POLL_URL_VALUE = TCG_POLL_URL(tmBaseUrl);

  while (!done) {
    // add a bit of jitter to avoid synchronized polling storms
    await new Promise((r) => setTimeout(r, 10000 + Math.random() * 5000));

    const poll = await apiClient.post({
      url: `${TCG_POLL_URL_VALUE}?x-bstack-traceRequestId=${encodeURIComponent(traceRequestId)}`,
      headers: {
        "API-TOKEN": getBrowserStackAuth(config),
      },
      body: {},
    });

    if (!poll.data.data.success) {
      throw new Error(`Polling failed: ${poll.data.data.message}`);
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

  // Promisify interval-style polling using a wrapper
  await new Promise<void>((resolve, reject) => {
    const intervalId = setInterval(async () => {
      try {
        const poll = await apiClient.post({
          url: `${TCG_POLL_URL_VALUE}?x-bstack-traceRequestId=${encodeURIComponent(traceId)}`,
          headers: {
            "API-TOKEN": getBrowserStackAuth(config),
          },
          body: {},
        });

        if (poll.status !== 200) {
          clearInterval(intervalId);
          reject(new Error(`Polling error: ${poll.statusText || poll.status}`));
          return;
        }

        for (const msg of poll.data.data.message) {
          if (msg.type === "scenario") {
            msg.data.scenarios.forEach((sc: any) => {
              scenariosMap[sc.id] = { id: sc.id, name: sc.name, testcases: [] };
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
            if (sc) {
              const array = Array.isArray(msg.data.testcases)
                ? msg.data.testcases
                : msg.data.testcases
                  ? [msg.data.testcases]
                  : [];
              const ids = array.map((tc: any) => tc.id || tc.test_case_id);

              const reqId = await fetchTestCaseDetails(
                documentId,
                folderId,
                projectReferenceId,
                ids,
                source,
                config,
              );
              detailPromises.push(pollTestCaseDetails(reqId, config));

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
            clearInterval(intervalId);
            resolve();
          }
        }
      } catch (err) {
        clearInterval(intervalId);
        reject(err);
      }
    }, 10000); // 10 second interval
  });

  // once all detail fetches are triggered, wait for them to complete
  const detailsList = await Promise.all(detailPromises);
  const allDetails = detailsList.reduce((acc, cur) => ({ ...acc, ...cur }), {});

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
  const results: Record<string, any> = {};
  const total = Object.keys(scenariosMap).length;
  let doneCount = 0;
  let testCaseCount = 0;
  const tmBaseUrl = await getTMBaseURL(config);
  const BULK_CREATE_URL_VALUE = BULK_CREATE_URL(tmBaseUrl, projectId, folderId);

  for (const { id, testcases } of Object.values(scenariosMap)) {
    const testCaseLength = testcases.length;
    testCaseCount += testCaseLength;
    if (testCaseLength === 0) continue;
    const payload = {
      test_cases: testcases.map((tc) =>
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
      const resp = await apiClient.post({
        url: BULK_CREATE_URL_VALUE,
        headers: {
          "API-TOKEN": getBrowserStackAuth(config),
          "Content-Type": "application/json",
        },
        body: payload,
      });
      results[id] = resp.data;
      await context.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: context._meta?.progressToken ?? "bulk-create",
          message: `Saving and creating test cases...`,
          total,
          progress: doneCount,
        },
      });
    } catch (error) {
      //send notification
      await context.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: context._meta?.progressToken ?? traceId,
          message: `Creation failed for scenario ${id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          total,
          progress: doneCount,
        },
      });
      //continue to next scenario
      continue;
    }
    doneCount++;
  }
  const resultString = `Total of ${testCaseCount} test cases created in ${total} scenarios.`;
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
