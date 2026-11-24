import { requireAdmin } from "@/lib/admin/auth";
import { leadStats, listLeads } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const [stats, leads] = await Promise.all([leadStats(), listLeads()]);
  return Response.json({ stats, leads });
}
