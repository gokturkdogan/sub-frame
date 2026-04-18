/**
 * Yerel Whisper için Python + PyTorch'un CUDA kullanıp kullanmadığını kontrol eder.
 * Çalıştır: npm run whisper:check-gpu
 */
import { spawnSync } from "child_process";

const snippet = `
import sys
try:
    import torch
except ImportError:
    print("NO_TORCH")
    sys.exit(2)
ok = torch.cuda.is_available()
print("CUDA_AVAILABLE=" + str(ok))
if ok:
    print("DEVICE=" + str(torch.cuda.get_device_name(0)))
sys.exit(0)
`;

function tryPython(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function main() {
  const candidates = [
    ["python", ["-c", snippet]],
    ["py", ["-3", "-c", snippet]],
    ["python3", ["-c", snippet]],
  ];

  let lastErr = "";

  for (const [bin, argv] of candidates) {
    const r = tryPython(bin, argv);
    if (r.error) {
      lastErr = String(r.error.message || r.error);
      continue;
    }
    const out = (r.stdout || "").trim();
    const err = (r.stderr || "").trim();

    if (r.status === 2 || out.includes("NO_TORCH")) {
      console.log(
        "PyTorch yüklü değil veya import edilemedi. Yerel Whisper için örnek:\n" +
          "  pip install openai-whisper torch --index-url https://download.pytorch.org/whl/cu124\n" +
          "(CUDA sürümünü NVIDIA sürücünüze göre seçin; CPU için --index-url kullanmayın.)"
      );
      process.exit(1);
    }

    if (r.status !== 0) {
      lastErr = err || out || `çıkış kodu ${r.status}`;
      continue;
    }

    console.log(out);
    if (!out.includes("CUDA_AVAILABLE=True")) {
      console.log(
        "\nCUDA görünmüyor; Whisper CPU ile çalışır (yavaş olabilir). GPU için CUDA destekli PyTorch kurun."
      );
    }
    process.exit(0);
  }

  console.error(
    "Python bulunamadı veya kontrol başarısız.\n" +
      `Son hata: ${lastErr || "bilinmiyor"}\n` +
      "PATH'te python veya py komutunun olduğundan emin olun."
  );
  process.exit(1);
}

main();
