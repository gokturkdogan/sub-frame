import { tmpdir } from "os";
import path from "path";

const TMP_SUBDIR = "subframe-jobs";

export function getTmpRoot(): string {
  return path.join(tmpdir(), TMP_SUBDIR);
}

export function getJobDir(jobId: string): string {
  return path.join(getTmpRoot(), jobId);
}

export function getJobPaths(jobId: string) {
  const dir = getJobDir(jobId);
  return {
    dir,
    inputVideo: path.join(dir, "input.mp4"),
    audioWav: path.join(dir, "audio.wav"),
    trSrt: path.join(dir, "tr.srt"),
    translatedSrt: path.join(dir, "translated.srt"),
    finalMp4: path.join(dir, "final.mp4"),
  };
}
