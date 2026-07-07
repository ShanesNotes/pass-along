import { logger as defaultLogger, runWithRequestContext, type Logger } from "./logger.js";
import { createRequestId, withRequestId } from "./request-id.js";
import {
  clientIpFrom,
  ipHashPrefix,
  tooManyRequestsResponse,
  type RateLimiter
} from "./rate-limiter.js";

export interface RouteGuardOptions {
  readonly route: string;
  readonly limiter: RateLimiter;
  readonly logger?: Logger;
  readonly now?: () => number;
}

// Wraps a route handler with rate limiting, a per-request id (echoed as
// x-request-id), and an access log line. Degradation warns emitted deeper in
// the call tree (via the shared logger) automatically pick up the same
// request_id/route through runWithRequestContext.
export async function withRouteGuard(
  request: Request,
  options: RouteGuardOptions,
  handle: (request: Request) => Promise<Response>
): Promise<Response> {
  const requestId = createRequestId();
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => Date.now());

  return runWithRequestContext(
    { request_id: requestId, route: options.route },
    async () => {
      const ip = clientIpFrom(request);
      const limit = options.limiter.check(ip);

      if (!limit.allowed) {
        const retryAfterSec = limit.retryAfterSec ?? 60;

        log.log("http.rate_limited", {
          ip_hash: ipHashPrefix(ip),
          retry_after_sec: retryAfterSec
        });

        return withRequestId(tooManyRequestsResponse(retryAfterSec), requestId);
      }

      const startedAt = now();
      const response = await handle(request);

      log.log("http.request", {
        status: response.status,
        latency_ms: Math.max(0, Math.round(now() - startedAt))
      });

      return withRequestId(response, requestId);
    }
  );
}
