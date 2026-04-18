import { randomUUID } from "crypto";
import fs from "fs/promises";
import { NextResponse } from "next/server";

import { TARGET_LANGUAGES } from "@/lib/lang";
import {
  normalizeTranslateEngineInput,
  serverDefaultTranslateEngine,
} from "@/lib/translate-models";
import {
  normalizeWhisperModelInput,
  serverDefaultWhisperModel,
} from "@/lib/whisper-models";
import { logBullet, logOk, logSection, logTech } from "@/lib/friendly-job-log";
import { updateJob } from "@/lib/job-store";
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
    const whisperModel = normalizeWhisperModelInput(
      String(form.get("whisperModel") || ""),
      serverDefaultWhisperModel()
    );
    const translateEngine = normalizeTranslateEngineInput(
      String(form.get("translateEngine") || ""),
      serverDefaultTranslateEngine()
    );

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
      progress: 5,
      step: "Video kaydediliyor",
      stepCode: "saving_video",
      progressHint: "1/5 · Dosya sunucuya yazılıyor…",
      whisperModel,
      translateEngine,
    });

    const paths = getJobPaths(jobId);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(paths.inputVideo, buf);
    const mb = (buf.byteLength / (1024 * 1024)).toFixed(2);
    logSection(jobId, "📥", "Video sunucuya kaydedildi");
    logOk(jobId, `Dosya adı: ${file.name}`);
    logBullet(jobId, `Boyut: ${mb} MB`);
    logTech(jobId, `Kayıt yolu: input.mp4`);

    updateJob(jobId, {
      progress: 12,
      step: "Video alındı",
      stepCode: "video_ready",
      progressHint: "Video hazır — birazdan ses ayıklanacak (genel ~%12)",
    });

    void runPipeline(jobId, targetLang, translateEngine);

    return NextResponse.json({
      jobId,
      downloadUrl: `/api/download/${jobId}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Yükleme başarısız";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
