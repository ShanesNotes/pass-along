import {
  createFindPostHandler,
  defaultFindRouteDeps
} from "./deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const deps = await defaultFindRouteDeps();
  return createFindPostHandler(deps)(request);
}
