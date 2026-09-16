import { apiClient } from "../../lib/apiClient.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

export interface RAGChunk {
  url: string;
  content: string;
}

import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";

export interface AccessibilityRAGResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export async function queryAccessibilityRAG(
  userQuery: string,
  config: BrowserStackConfig,
): Promise<any> {
  const url = "https://accessibility.browserstack.com/api/tcg-proxy/search";

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.post({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: {
      query: userQuery,
    },
    raise_error: false,
  });

  if (!response.ok) {
    const errorText =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    throw new Error(`RAG endpoint error: ${response.status} ${errorText}`);
  }

  const responseData = response.data as any;

  if (!responseData.success) {
    throw new Error("Something went wrong: " + responseData.message);
  }

  // Parse the stringified JSON data
  let parsedData;
  try {
    parsedData = JSON.parse(responseData.data);
  } catch (err) {
    throw new Error(
      "Failed to parse RAG response data as JSON: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  if (
    !parsedData ||
    !parsedData.data ||
    !Array.isArray(parsedData.data.chunks)
  ) {
    throw new Error(
      "RAG response data is missing expected 'data.chunks' array",
    );
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

  const formattedResponse =
    instruction +
    wrapUntrusted("BrowserStack accessibility documentation", formattedChunks);

  return {
    content: [
      {
        type: "text",
        text: formattedResponse,
      },
    ],
  };
}
