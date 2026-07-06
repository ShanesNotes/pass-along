import {
  createAdminQueueGetHandler,
  defaultAdminRouteDeps
} from "../deps";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // Future Supabase-auth seam: replace this demo bearer token with admin-role auth.
  return createAdminQueueGetHandler(defaultAdminRouteDeps())(request);
}
