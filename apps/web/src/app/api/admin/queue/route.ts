import {
  createAdminQueueGetHandler,
  defaultAdminRouteDeps
} from "../deps";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  // Future auth seam: wrap this demo handler with Supabase admin-role auth.
  return createAdminQueueGetHandler(defaultAdminRouteDeps())();
}
