import { config } from "../config";

// Every /api route requires the shared secret, matching the old Express
// middleware. The extension popup and the review UI both send it as a
// Bearer token.
export function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return token === config.server.sharedSecret;
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
