import {
  createPassPostHandler,
  defaultPassRouteDeps
} from "./deps";
import {
  InMemoryTokenBucketRateLimiter,
  ratePerMinute,
  withRouteGuard
} from "../../../../../../packages/engine/src/http/index";
import { loadConfig } from "../../../../../../packages/core/src/index";

export const runtime = "nodejs";

const routeConfig = loadConfig();
const passRateLimiter = new InMemoryTokenBucketRateLimiter(
  ratePerMinute(routeConfig.rateLimit.passPerMinute)
);

export async function POST(request: Request): Promise<Response> {
  return withRouteGuard(
    request,
    { route: "pass", limiter: passRateLimiter },
    async (req) => createPassPostHandler(defaultPassRouteDeps())(req)
  );
}
