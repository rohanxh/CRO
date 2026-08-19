import {
  clearSessionCookie,
  isAdminConfigured,
  isAuthed,
  login,
  setSessionCookie,
} from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: report auth state (used by the dashboard page to decide what to render).
export async function GET() {
  return Response.json({ configured: isAdminConfigured(), authed: await isAuthed() });
}

// POST: log in with the admin password.
export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD on the server, then restart." },
      { status: 403 }
    );
  }
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const token = login(password);
  if (!token) return Response.json({ error: "Incorrect password." }, { status: 401 });

  await setSessionCookie(token);
  return Response.json({ ok: true });
}

// DELETE: log out.
export async function DELETE() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
