import {
  createAdminDecidePostHandler,
  defaultAdminRouteDeps
} from "../deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Future auth seam: wrap this demo handler with Supabase admin-role auth.
  return createAdminDecidePostHandler(defaultAdminRouteDeps())(request);
}
