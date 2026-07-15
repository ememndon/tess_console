import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tessFiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve an attachment for inline preview/download — owner-only (chats are private).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const [f] = await db.select().from(tessFiles).where(eq(tessFiles.id, id));
  if (!f) return new NextResponse("Not found", { status: 404 });
  if (f.userId && f.userId !== user.id) return new NextResponse("Forbidden", { status: 403 });

  const bytes = Buffer.from(f.data, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
