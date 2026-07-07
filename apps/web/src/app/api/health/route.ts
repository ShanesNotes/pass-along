import { computeHealth, defaultHealthRouteDeps } from "./deps";

export const runtime = "nodejs";

// No rate limiter (health endpoints get polled constantly) and no request
// body to validate (GET, zero user input) — see docs/DEPLOY.md.
export async function GET(): Promise<Response> {
  const body = await computeHealth(defaultHealthRouteDeps());

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
