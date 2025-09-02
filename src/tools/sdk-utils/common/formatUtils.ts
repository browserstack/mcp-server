export function formatInstructionsWithNumbers(
  instructionText: string,
  separator: string = "---STEP---",
): { formattedSteps: string; stepCount: number } {
  // Split the instructions by the separator
  const steps = instructionText
    .split(separator)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);

  // If no separators found, treat the entire text as one step
  if (steps.length === 1 && !instructionText.includes(separator)) {
    return {
      formattedSteps: `**Step 1:**\n${instructionText.trim()}`,
      stepCount: 1,
    };
  }

  // Format each step with numbering
  const formattedSteps = steps
    .map((step, index) => {
      return `**Step ${index + 1}:**\n${step.trim()}`;
    })
    .join("\n\n");

  return {
    formattedSteps,
    stepCount: steps.length,
  };
}

export function generateVerificationMessage(stepCount: number): string {
  return `**✅ Verification:**\nPlease verify that you have completed all ${stepCount} steps above to ensure proper setup. If you encounter any issues, double-check each step and ensure all commands executed successfully.`;
}
