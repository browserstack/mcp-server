import type { ToolSpec } from "../harness/cases.js";
import { EU_HOST } from "../harness/cases.js";
import { L3_UPLOAD_DIR } from "../harness/server.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Any Test Management host (US, EU, IN), so a stub serves the region case too. */
const TM = String.raw`https://test-management(-eu|-in)?\.browserstack\.com`;
const tm = (path: string) => new RegExp(`^${TM}${path}(\\?.*)?$`);

/** The US probe of getTMBaseURL: the first host that answers 200 is used. */
const TM_PROBE = { method: "GET", url: tm("/api/v2/projects/") } as const;

export const testManagementSpecs: ToolSpec[] = [
  {
    tool: "listTestCases",
    args: { project_identifier: "PR-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-cases"),
        body: {
          success: true,
          info: { count: 1 },
          test_cases: [
            {
              identifier: "TC-1",
              title: "Remote title 7c1",
              case_type: "Functional",
              priority: "High",
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 test case/],
      untrusted: ["Remote title 7c1"],
      calls: [{ method: "GET", url: tm("/api/v2/projects/PR-1/test-cases") }],
    },
    region: { hosts: [EU_HOST] },
  },
];

/** projectIdentifierToId: GET /api/v1/projects/?q=PR-1 resolves PR-1 to the numeric id 42. */
const PROJECT_LOOKUP = {
  method: "GET",
  url: tm("/api/v1/projects/"),
  body: { success: true, projects: [{ identifier: "PR-1", id: 42 }] },
} as const;

/** A small requirements file inside MCP_UPLOAD_BASE_DIR for uploadProductRequirementFile. */
const PRD_FILE = join(L3_UPLOAD_DIR, "prd.txt");
writeFileSync(PRD_FILE, "As a user I can log in with email and password.\n");

testManagementSpecs.push(
  {
    tool: "createProjectOrFolder",
    args: { project_identifier: "PR-1", folder_name: "Checkout" },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "POST",
        url: tm("/api/v2/projects/PR-1/folders"),
        body: {
          success: true,
          folder: { id: 77, name: "Remote folder 3f9" },
        },
      },
    ],
    // No untrusted assertion: the success text prints folder.name from the response
    // without wrapUntrusted (create-project-folder.ts, "Name: ${folder.name}").
    happy: {
      isError: false,
      textMatches: [/Folder successfully created/, /ID: 77/],
      calls: [{ method: "POST", url: tm("/api/v2/projects/PR-1/folders") }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "createTestCase",
    args: {
      project_identifier: "PR-1",
      folder_id: "77",
      name: "Login works",
      test_case_steps: [{ step: "Open login", result: "Form shows" }],
    },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "POST",
        url: tm("/api/v2/projects/PR-1/folders/77/test-cases"),
        body: {
          data: {
            success: true,
            test_case: { identifier: "TC-9", title: "Remote title 2a8" },
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Test case successfully created/, /Identifier: TC-9/],
      untrusted: ["Remote title 2a8"],
      calls: [
        {
          method: "POST",
          url: tm("/api/v2/projects/PR-1/folders/77/test-cases"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "updateTestCase",
    args: {
      project_identifier: "PR-1",
      test_case_identifier: "TC-9",
      name: "Login works v2",
    },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "PATCH",
        url: tm("/api/v2/projects/PR-1/test-cases/TC-9"),
        body: {
          data: {
            success: true,
            test_case: {
              identifier: "TC-9",
              title: "Remote title 6d2",
              case_type: "Functional",
              priority: "High",
              status: "Active",
              folder_id: 77,
            },
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Test case successfully updated/],
      untrusted: ["Remote title 6d2"],
      calls: [
        { method: "PATCH", url: tm("/api/v2/projects/PR-1/test-cases/TC-9") },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listFolders",
    args: { project_identifier: "PR-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/folders"),
        body: {
          success: true,
          info: { count: 1 },
          folders: [
            {
              id: 77,
              name: "Remote folder 8b4",
              cases_count: 3,
              sub_folders_count: 0,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 folder\(s\) in project PR-1/],
      untrusted: ["Remote folder 8b4"],
      calls: [{ method: "GET", url: tm("/api/v2/projects/PR-1/folders") }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listTestCaseTemplates",
    args: {},
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v1/admin-v2/settings/templates"),
        body: {
          templates: [
            {
              id: 501,
              name: "Remote template 1c7",
              step_type: "test_case_steps",
              is_system: false,
              is_default: false,
              enabled: true,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 template\(s\)/],
      untrusted: ["Remote template 1c7"],
      calls: [
        { method: "GET", url: tm("/api/v1/admin-v2/settings/templates") },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "createTestRun",
    args: { project_identifier: "PR-1", test_run: { name: "Sprint 9" } },
    http: [
      TM_PROBE,
      {
        method: "POST",
        url: tm("/api/v2/projects/PR-1/test-runs"),
        body: {
          success: true,
          test_run: { identifier: "TR-3", name: "Remote run 4d2" },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Successfully created test run TR-3/],
      untrusted: ["Remote run 4d2"],
      calls: [{ method: "POST", url: tm("/api/v2/projects/PR-1/test-runs") }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listTestRuns",
    args: { project_identifier: "PR-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-runs"),
        body: {
          success: true,
          test_runs: [
            {
              identifier: "TR-3",
              name: "Remote run 5e1",
              run_state: "new_run",
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 test run\(s\)/],
      untrusted: ["Remote run 5e1"],
      calls: [{ method: "GET", url: tm("/api/v2/projects/PR-1/test-runs") }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "updateTestRun",
    args: {
      project_identifier: "PR-1",
      test_run_id: "TR-3",
      test_run: { name: "Sprint 9 final" },
    },
    http: [
      TM_PROBE,
      {
        method: "PATCH",
        url: tm("/api/v2/projects/PR-1/test-runs/TR-3/update"),
        body: {
          success: true,
          testrun: { identifier: "TR-3", name: "Remote run 9e4" },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Successfully updated test run TR-3/],
      untrusted: ["Remote run 9e4"],
      calls: [
        {
          method: "PATCH",
          url: tm("/api/v2/projects/PR-1/test-runs/TR-3/update"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "addTestResult",
    args: {
      project_identifier: "PR-1",
      test_run_id: "TR-3",
      test_case_id: "TC-9",
      test_result: { status: "passed" },
    },
    http: [
      TM_PROBE,
      {
        method: "POST",
        url: tm("/api/v2/projects/PR-1/test-runs/TR-3/results"),
        body: {
          success: true,
          "test-result": {
            id: 9001,
            status: "passed",
            description: "Remote note 5b1",
          },
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Successfully added test result with ID=9001/],
      untrusted: ["Remote note 5b1"],
      calls: [
        {
          method: "POST",
          url: tm("/api/v2/projects/PR-1/test-runs/TR-3/results"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "uploadProductRequirementFile",
    args: { project_identifier: "PR-1", file_path: PRD_FILE },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "POST",
        url: tm("/api/v1/projects/42/generic/attachments/ai_uploads"),
        body: {
          generic_attachment: [
            {
              id: 3101,
              name: "prd.txt",
              content_type: "text/plain",
              size: 48,
              download_url: "https://example.invalid/signed/prd.txt",
            },
          ],
        },
      },
    ],
    // No untrusted assertion: the attachment list (name, content_type from the
    // response) is printed as plain JSON without wrapUntrusted (upload-file.ts).
    happy: {
      isError: false,
      textMatches: [
        /Successfully uploaded prd\.txt to BrowserStack Test Management/,
        /"documentID": "[0-9a-f-]{36}"/,
        /"projectReferenceId": 42/,
      ],
      calls: [
        {
          method: "POST",
          url: tm("/api/v1/projects/42/generic/attachments/ai_uploads"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "createTestCasesFromFile",
    args: {
      documentId: "doc-unknown",
      folderId: "77",
      projectReferenceId: "PR-1",
    },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "GET",
        url: tm("/api/v1/projects/42/form-fields-v2"),
        body: {
          default_fields: {
            priority: { values: [{ name: "High", value: 1 }] },
            status: { values: [{ internal_name: "active", value: 1 }] },
            case_type: { values: [{ internal_name: "functional", value: 1 }] },
          },
          custom_fields: [],
        },
      },
    ],
    // The document comes from uploadProductRequirementFile (in-memory signedUrlMap),
    // which a single row cannot chain, and TCG polls on a fixed 10 s setInterval
    // (TCG-utils/config.ts TCG_POLL_INTERVAL_MS) that a stub cannot shorten.
    happy:
      "n/a: needs a document from an earlier uploadProductRequirementFile call (in-memory signedUrlMap) and TCG polling waits a fixed 10 s per tick (TCG_POLL_INTERVAL_MS); no fake timers in the harness",
    // Region checks the hosts only. The unknown document stops the flow after the
    // project lookup and the form-fields call, both of which must go to EU.
    region: {
      hosts: [EU_HOST],
      expect: {
        isError: true,
        textMatches: [/Document with ID doc-unknown not found/],
      },
    },
  },
  {
    tool: "createLCASteps",
    // wait_for_completion=false: pollLCAStatus waits 2 min before the first poll.
    args: {
      project_identifier: "PR-1",
      test_case_identifier: "TC-5",
      base_url: "example.com",
      test_name: "Login flow",
      test_case_details: {
        name: "Login flow",
        description: "User logs in",
        preconditions: "User exists",
        test_case_steps: [{ step: "Open login", result: "Form shows" }],
      },
      wait_for_completion: false,
    },
    http: [
      TM_PROBE,
      PROJECT_LOOKUP,
      {
        method: "GET",
        url: tm("/api/v1/projects/42/test-cases/search"),
        body: {
          success: true,
          test_cases: [
            {
              identifier: "TC-5",
              id: 555,
              links: { folder: "/api/v1/projects/42/folder/77/test-cases" },
            },
          ],
        },
      },
      {
        method: "POST",
        url: tm("/api/v1/projects/42/test-cases/555/lcnc"),
        body: { success: true },
      },
    ],
    // No untrusted assertion: the result prints only the caller's identifier and the
    // numeric test case id, no remote text.
    happy: {
      isError: false,
      textMatches: [
        /LCA steps creation initiated for test case TC-5 \(ID: 555\)/,
      ],
      calls: [
        { method: "POST", url: tm("/api/v1/projects/42/test-cases/555/lcnc") },
      ],
    },
    region: { hosts: [EU_HOST] },
    knownIssues: {
      auth: "create-lca-steps.ts catch replaces a 401 with 'Failed to create LCA steps. Please verify the inputs'; no auth hint",
    },
  },
  {
    tool: "listTestPlans",
    args: { project_identifier: "PR-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans"),
        body: {
          success: true,
          info: { count: 1 },
          test_plans: [
            {
              identifier: "TP-1",
              name: "Remote plan 0a3",
              active_state: "active",
              test_runs_count: { active: 1, closed: 0 },
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 test plan\(s\) in project PR-1/],
      untrusted: ["Remote plan 0a3"],
      calls: [{ method: "GET", url: tm("/api/v2/projects/PR-1/test-plans") }],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "getTestPlan",
    args: { project_identifier: "PR-1", test_plan_identifier: "TP-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans/TP-1"),
        body: {
          success: true,
          test_plan: {
            identifier: "TP-1",
            name: "Remote plan 7f5",
            active_state: "active",
            test_runs_count: { active: 1, closed: 0 },
          },
        },
      },
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans/TP-1/test-runs"),
        body: {
          success: true,
          test_runs: [
            {
              identifier: "TR-3",
              name: "Remote run 2c6",
              run_state: "in_progress",
              test_cases_count: 4,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Test Plan TP-1/, /Linked runs: 1/],
      untrusted: ["Remote plan 7f5", "Remote run 2c6"],
      calls: [
        { method: "GET", url: tm("/api/v2/projects/PR-1/test-plans/TP-1") },
        {
          method: "GET",
          url: tm("/api/v2/projects/PR-1/test-plans/TP-1/test-runs"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "listSubTestPlans",
    args: { project_identifier: "PR-1", parent_test_plan_identifier: "TP-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans/TP-1/sub-test-plans"),
        body: {
          success: true,
          info: { count: 1 },
          sub_test_plans: [
            {
              identifier: "STP-3",
              name: "Remote sub-plan 4a9",
              active_state: "active",
              test_runs_count: { active: 0, closed: 1 },
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 sub-test-plan\(s\) under TP-1 in project PR-1/],
      untrusted: ["Remote sub-plan 4a9"],
      calls: [
        {
          method: "GET",
          url: tm("/api/v2/projects/PR-1/test-plans/TP-1/sub-test-plans"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
  {
    tool: "getSubTestPlan",
    args: {
      project_identifier: "PR-1",
      parent_test_plan_identifier: "TP-1",
      sub_test_plan_identifier: "STP-3",
    },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans/TP-1/sub-test-plans/STP-3"),
        body: {
          success: true,
          sub_test_plan: {
            identifier: "STP-3",
            name: "Remote sub-plan 6b8",
            parent_plan_id: 11,
            active_state: "active",
            test_runs_count: { active: 1, closed: 0 },
            links: {
              test_runs: "/api/v2/projects/PR-1/test-plans/STP-3/test-runs",
            },
          },
        },
      },
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-plans/STP-3/test-runs"),
        body: {
          success: true,
          test_runs: [
            {
              identifier: "TR-4",
              name: "Remote run 3d7",
              run_state: "done",
              test_cases_count: 2,
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Sub-Test-Plan STP-3/, /Linked runs: 1/],
      untrusted: ["Remote sub-plan 6b8", "Remote run 3d7"],
      calls: [
        {
          method: "GET",
          url: tm("/api/v2/projects/PR-1/test-plans/TP-1/sub-test-plans/STP-3"),
        },
        {
          method: "GET",
          url: tm("/api/v2/projects/PR-1/test-plans/STP-3/test-runs"),
        },
      ],
    },
    region: { hosts: [EU_HOST] },
  },
);
