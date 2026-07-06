import {
  createPassPostHandler,
  defaultPassRouteDeps
} from "./deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return createPassPostHandler(defaultPassRouteDeps())(request);
}
