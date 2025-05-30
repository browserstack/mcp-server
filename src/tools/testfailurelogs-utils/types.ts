//Interface for test observability logs
export interface TestObservabilityLog {
  sdkLogs: string[];
  failureLogs: any[];
  browserstackLogs?: any | null;
  hookRunLogs: string[];
  framework?: string | null;
}

//Interface for test details
export interface ObservabilityTestDetails {
  testCode: any;
  testMetadata: any;
}

//Interface for log response structure
export interface TestObservabilityLogResponse {
  testStartedAt?: string;
  testFinishedAt?: string;
  browserstackLogs?: any | null;
  sdkLogs: string[];
  hookRunLogs: string[];
  failureLogs: any[];
  stepLogs: any[];
  framework?: string | null;
  sessionId?: string | null;
}
