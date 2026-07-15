import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tessFiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 10 * 1024 * 1024; // 10 MB

// Text-like files get an extracted excerpt so non-vision models can still read them.
function isTexty(mime: string, name: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (/^application\/(json|xml|x-yaml|yaml|javascript|x-sh|x-httpd-php|sql|csv)$/.test(mime)) return true;
  return /\.(txt|md|markdown|csv|tsv|json|ya?ml|log|html?|xml|ts|tsx|js|jsx|mjs|cjs|css|scss|py|rb|go|rs|java|kt|c|cpp|h|sh|bash|sql|env|ini|conf|toml)$/i.test(name);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: `File too large (max ${MAX / 1024 / 1024} MB).` }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const data = buf.toString("base64");
  let textExcerpt: string | null = null;
  if (isTexty(mime, file.name)) {
    try {
      textExcerpt = buf.toString("utf8").slice(0, 8000);
    } catch {
      textExcerpt = null;
    }
  }

  const [row] = await db
    .insert(tessFiles)
    .values({ userId: user.id, name: file.name.slice(0, 200) || "file", mime, size: file.size, data, textExcerpt })
    .returning({ id: tessFiles.id });

  return NextResponse.json({ id: row.id, name: file.name, mime, size: file.size });
}
