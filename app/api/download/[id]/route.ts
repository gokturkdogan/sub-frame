import { createReadStream } from "fs";
import fs from "fs/promises";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { validate as validateUuid } from "uuid";

import { getJobPaths } from "@/lib/paths";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  if (!validateUuid(id)) {
    return NextResponse.json({ error: "Geçersiz kimlik" }, { status: 400 });
  }

  const paths = getJobPaths(id);
  try {
    await fs.stat(paths.finalMp4);
  } catch {
    return NextResponse.json(
      { error: "Dosya hazır değil veya süresi doldu" },
      { status: 404 }
    );
  }

  /** İndirme bitince işi silme: sayfa /status yoklaması 404 verir. Temizlik `scheduleJobDeletion` (pipeline) ile yapılır. */
  const nodeStream = createReadStream(paths.finalMp4);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="altyazili-${id.slice(0, 8)}.mp4"`,
    },
  });
}
