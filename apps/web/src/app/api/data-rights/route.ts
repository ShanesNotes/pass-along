import {
  InMemoryTokenBucketRateLimiter,
  ratePerMinute,
  withRouteGuard
} from "../../../../../../packages/engine/src/http/index";
import {
  createDataRightsPostHandler,
  defaultDataRightsRouteDeps
} from "./deps";

export const runtime = "nodejs";

// This is a human-processing queue (Danielle reviews each row), not an
// automated deletion trigger — see docs/PRIVACY-LIFECYCLE.md. A low, fixed
// cap is plenty; not wired to packages/core/src/config.ts's rate-limit
// group because that file is outside this packet's scope and this endpoint
// doesn't need per-deployment tuning the way find/pass/typeahead do.
const DATA_RIGHTS_RATE_LIMIT_PER_MIN = 5;
const routeRateLimiter = new InMemoryTokenBucketRateLimiter(
  ratePerMinute(DATA_RIGHTS_RATE_LIMIT_PER_MIN)
);

export async function POST(request: Request): Promise<Response> {
  return withRouteGuard(
    request,
    { route: "data-rights", limiter: routeRateLimiter },
    async (req) =>
      createDataRightsPostHandler(await defaultDataRightsRouteDeps())(req)
  );
}
