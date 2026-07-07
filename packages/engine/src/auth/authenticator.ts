// Port for admin-route authorization. Route code turns the outcome into a
// Response (status + error body); this layer never touches Response itself
// so it stays framework-agnostic and easy to unit test.
export type AdminAuthOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401 | 503;
      readonly error: "ADMIN_UNAUTHORIZED" | "ADMIN_DISABLED";
      readonly reason?: string;
    };

export interface AdminAuthenticator {
  authorize(request: Request): Promise<AdminAuthOutcome> | AdminAuthOutcome;
}

export function bearerTokenFrom(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/iu.exec(authorization)?.[1]?.trim();
}
