const content: { type: "text"; text: string }[] = [];

export async function updateFileAndStep(
  file: string,
  idx: number,
  total: number,
  instruction: string,
) {
  content.length = 0;
  const nextIndex = idx + 1;

  content.push({
    type: "text",
    text: `Complete all steps in order. If a tool call is requested, update the file first, then call the tool. Follow instructions exactly— do not skip any steps to ensure all files are updated.`,
  });

  content.push({
    type: "text",
    text: `Step 1 : You need to add percy snapshot commands in some key test cases in the file ${file} use the following instructions: \n${instruction}`,
  });
    
  content.push({
    type: "text",
    text: `Step 2 : Confirm that Percy snapshot commands have been added at all key points of visual change in the file ${file}.`,
  });

  if (nextIndex < total) {
    content.push({
      type: "text",
      text: `Step 3 : Call the tool updateTestFileWithInstructions with index as ${nextIndex} out of ${total}`,
    });
  }
  return content;
}
