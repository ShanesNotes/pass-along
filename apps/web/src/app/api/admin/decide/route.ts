import {
  createAdminDecidePostHandler,
  defaultAdminRouteDeps
} from "../deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Future Supabase-auth seam: replace this demo bearer token with admin-role auth.
  return createAdminDecidePostHandler(defaultAdminRouteDeps())(request);
}
