// Imported first by http-server.ts, before anything reads configuration.
//
// The HTTP server is the multi-user (remote) deployment shape, so it runs in
// REMOTE_MCP mode unless told otherwise: local-machine features (Local tunnel,
// opening browsers) are refused, and the stdio entrypoint's main(), which some
// tool modules import transitively, returns early instead of attaching a
// second, stdio server.
if (process.env.REMOTE_MCP === undefined) process.env.REMOTE_MCP = "true";
