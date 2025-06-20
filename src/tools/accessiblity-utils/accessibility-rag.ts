import fetch from "node-fetch";
import config from "../../config.js";

export interface RAGChunk {
  url: string;
  content: string;
}

export async function queryAccessibilityRAG(userQuery: string): Promise<any> {
  const url = "https://accessibility.browserstack.com/api/tcg-proxy/search";

  const auth = Buffer.from(
    `${config.browserstackUsername}:${config.browserstackAccessKey}`,
  ).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      query: userQuery,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RAG endpoint error: ${response.status} ${errorText}`);
  }

  const responseData = (await response.json()) as any;

  if (!responseData.success) {
    throw new Error("Something went wrong: " + responseData.message);
  }

  // Parse the stringified JSON data
  let parsedData;
  try {
    parsedData = JSON.parse(responseData.data);
  } catch {
    throw new Error("Failed to parse RAG response data as JSON");
  }

  const chunks: RAGChunk[] = parsedData.data.chunks;

  // Format the response properly
  const instruction =
    "IMPORTANT: Use ONLY the data provided below to answer the user's accessibility question. Do not use any external knowledge. When answering, you MUST include the relevant BrowserStack documentation links provided in the sources for personalization and further reference.\n\n";

  const formattedChunks = chunks
    .map(
      (chunk, index) =>
        `${index + 1}: Source: ${chunk.url}\n\n${chunk.content}`,
    )
    .join("\n\n---\n\n");

  const formattedResponse = instruction + formattedChunks;

  return {
    content: [
      {
        type: "text",
        text: formattedResponse,
      },
    ],
  };
}
