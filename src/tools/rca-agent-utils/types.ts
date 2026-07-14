export enum TestStatus {
  PASSED = "passed",
  FAILED = "failed",
  PENDING = "pending",
  SKIPPED = "skipped",
}

export interface TestDetails {
  status: TestStatus;
  details: any;
  children?: TestDetails[];
  display_name?: string;
}

export interface TestRun {
  hierarchy: TestDetails[];
  pagination?: {
    has_next: boolean;
    next_page: string | null;
  };
}

// Trimmed per-test failure signature for downstream clustering.
// Never carries full stack traces — error_summary is a single capped line.
export interface TestFailureSignature {
  category?: string;
  error_summary?: string;
  file_path?: string;
  is_flaky?: boolean;
  is_always_failing?: boolean;
  is_new_failure?: boolean;
}

export interface FailedTestInfo {
  test_id: number;
  test_name: string;
  // Present only when listTestIds is called with includeFailureDetail=true.
  failure?: TestFailureSignature;
}

export enum RCAState {
  PENDING = "pending",
  FETCHING_LOGS = "fetching_logs",
  GENERATING_RCA = "generating_rca",
  GENERATED_RCA = "generated_rca",
  COMPLETED = "completed",
  FAILED = "failed",
  LLM_SERVICE_ERROR = "LLM_SERVICE_ERROR",
  LOG_FETCH_ERROR = "LOG_FETCH_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  TIMEOUT = "TIMEOUT",
}

export interface RCATestCase {
  id: number;
  testRunId: number;
  state: RCAState;
  rcaData?: any;
}

export interface RCAResponse {
  testCases: RCATestCase[];
}

export interface BuildIdArgs {
  browserStackProjectName: string;
  browserStackBuildName: string;
}
