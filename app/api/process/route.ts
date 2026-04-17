import { randomUUID } from "crypto";
import fs from "fs/promises";
import { NextResponse } from "next/server";

import { TARGET_LANGUAGES } from "@/lib/lang";
import { appendJobLog, updateJob } from "@/lib/job-store";
import { ensureJobDir, runPipeline } from "@/lib/pipeline";
import { getJobPaths } from "@/lib/paths";

export const runtime = "nodejs";

const MAX_BYTES =
  Number(process.env.MAX_UPLOAD_BYTES) || 500 * 1024 * 1024;

const allowedCodes = new Set(TARGET_LANGUAGES.map((l) => l.code));

export async function POST(request: Request) {
  let jobId = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "multipart/form-data bekleniyor" },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const targetLang = String(form.get("targetLang") || "").trim();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Video dosyası eksik" }, { status: 400 });
    }
    if (!allowedCodes.has(targetLang)) {
      return NextResponse.json({ error: "Geçersiz hedef dil" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Dosya çok büyük (en fazla ${Math.floor(MAX_BYTES / (1024 * 1024))} MB)`,
        },
        { status: 413 }
      );
    }

    jobId = randomUUID();

    await ensureJobDir(jobId);
    updateJob(jobId, {
      status: "processing",
      progress: 6,
      step: "Yükleme kaydediliyor",
    });

    const paths = getJobPaths(jobId);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(paths.inputVideo, buf);
    appendJobLog(
      jobId,
      `Yükleme kaydedildi: input.mp4 (${buf.byteLength} bayt), ad=${file.name}`
    );

    updateJob(jobId, {
      progress: 14,
      step: "İşlem başlatılıyor",
    });

    void runPipeline(jobId, targetLang);

    return NextResponse.json({
      jobId,
      downloadUrl: `/api/download/${jobId}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Yükleme başarısız";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
