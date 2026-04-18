"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TARGET_LANGUAGES } from "@/lib/lang";
import { Film, Upload } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [targetLang, setTargetLang] = React.useState("tr");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onPick = (f: File | null) => {
    setError(null);
    setFile(f);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Lütfen bir video dosyası seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("targetLang", targetLang);
      const res = await fetch("/api/process", { method: "POST", body });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "İstek başarısız");
      }
      if (!data.jobId) throw new Error("İş kimliği alınamadı");
      router.push(`/result?job=${encodeURIComponent(data.jobId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Film className="size-5" />
            SubFrame
          </Link>
          <ModeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Video altyazı</CardTitle>
            <CardDescription>
              Videonuzu yükleyin. Konuşmayı Türkçe olarak yazıya dökeriz; altyazı dilini Türkçe
              seçerseniz çeviri yapılmaz, İngilizce veya Rusça seçerseniz bu dile çevirip MP4
              oluştururuz. İşlem bittikten sonra sunucuda veri tutulmaz.
            </CardDescription>
          </CardHeader>
          <form onSubmit={onSubmit}>
            <CardContent className="flex flex-col gap-6">
              <div className="space-y-2">
                <Label>Video dosyası</Label>
                <button
                  type="button"
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    const f = ev.dataTransfer.files?.[0];
                    if (f) onPick(f);
                  }}
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-muted/50"
                >
                  <Upload className="size-8 opacity-70" />
                  <span>
                    {file ? (
                      <span className="font-medium text-foreground">{file.name}</span>
                    ) : (
                      <>Videoyu buraya sürükleyin veya seçmek için tıklayın</>
                    )}
                  </span>
                  <span className="text-xs">MP4, MOV, MKV ve yaygın video biçimleri</span>
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(ev) => onPick(ev.target.files?.[0] ?? null)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lang">Altyazı dili</Label>
                <Select
                  value={targetLang}
                  onValueChange={(v) => {
                    if (v) setTargetLang(v);
                  }}
                >
                  <SelectTrigger id="lang" className="w-full max-w-md">
                    <SelectValue placeholder="Dil seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Türkçe: yalnızca yazıya döküm ve videoya gömme. İngilizce / Rusça: önce Türkçe
                  SRT, sonra çeviri.
                </p>
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
              <Button type="submit" disabled={busy} size="lg" className="w-full sm:w-auto">
                {busy ? "Başlatılıyor…" : "Videoyu işle"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    </div>
  );
}
