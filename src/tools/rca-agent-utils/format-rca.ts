// Utility function to format RCA data for better readability
export function formatRCAData(rcaData: any): string {
  if (!rcaData || !rcaData.testCases || rcaData.testCases.length === 0) {
    return "No RCA data available.";
  }

  let output = "## Root Cause Analysis Report\n\n";
  
  rcaData.testCases.forEach((testCase: any, index: number) => {
    // Show test case name first with smaller heading
    output += `### ${testCase.displayName || `Test Case ${index + 1}`}\n`;
    output += `**Test ID:** ${testCase.id}\n`;
    output += `**Status:** ${testCase.state}\n\n`;

    if (testCase.rcaData?.originalResponse?.rcaData) {
      const rca = testCase.rcaData.originalResponse.rcaData;
      
      if (rca.root_cause) {
        output += `**Root Cause:** ${rca.root_cause}\n\n`;
      }
      
      if (rca.description) {
        output += `**Description:**\n${rca.description}\n\n`;
      }
      
      if (rca.possible_fix) {
        output += `**Recommended Fix:**\n${rca.possible_fix}\n\n`;
      }
    }
    
    output += "---\n\n";
  });

  return output;
}
