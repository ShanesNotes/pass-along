import {
  createFindPostHandler,
  defaultFindRouteDeps
} from "./deps";
import {
  InMemoryTokenBucketRateLimiter,
  ratePerMinute,
  withRouteGuard
} from "../../../../../../packages/engine/src/http/index";
import { loadConfig } from "../../../../../../packages/core/src/index";

export const runtime = "nodejs";

const routeConfig = loadConfig();
const findRateLimiter = new InMemoryTokenBucketRateLimiter(
  ratePerMinute(routeConfig.rateLimit.findPerMinute)
);

export async function POST(request: Request): Promise<Response> {
  return withRouteGuard(
    request,
    { route: "find", limiter: findRateLimiter },
    async (req) => {
      const deps = await defaultFindRouteDeps();
      return createFindPostHandler(deps)(req);
    }
  );
}
