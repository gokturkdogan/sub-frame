import { NextResponse } from "next/server";
import { validate as validateUuid } from "uuid";

import { getJob } from "@/lib/job-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Params) {
  const { jobId } = await context.params;
  if (!validateUuid(jobId)) {
    return NextResponse.json({ error: "Geçersiz iş kimliği" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
    downloadPath: job.downloadPath,
    logs: job.logs ?? [],
  });
}
