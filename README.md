# SubFrame

**Yapay zekâ destekli video altyazı aracı.** Videodaki konuşmayı önce Türkçe metne döker, seçtiğiniz dile çevirir ve yumuşak altyazılı (soft sub) bir **MP4** üretir. İşlem tamamlandıktan sonra geçici dosyalar belirlenen süre içinde sunucudan silinir.

---

## Özellikler

- Türkçe konuşma tanıma (Whisper API veya yerel `whisper` CLI)
- Birden çok hedef dil (İngilizce, Almanca, Japonca vb.)
- FFmpeg ile ses çıkarma ve altyazıyı videoya gömme (yeniden kodlamadan mux mümkün olduğunda)
- Açık / koyu tema (`next-themes`)
- İşlem durumu ve günlük çıktısı ile ilerleme takibi

---

## Nasıl çalışır?

```mermaid
flowchart LR
  A[Video yükleme] --> B[FFmpeg: WAV ses]
  B --> C[Türkçe SRT]
  C --> D[Hedef dile çeviri]
  D --> E[FFmpeg: MP4 + soft sub]
  E --> F[İndirme]
```

1. Tarayıcıdan video ve hedef dil gönderilir.  
2. Sunucu geçici klasöre yazar ve işlem hattını başlatır.  
3. Ses çıkarılır → Türkçe altyazı üretilir → satırlar çevrilir → MP4 oluşturulur.  
4. Sonuç sayfasından indirilir; süre dolunca dosyalar temizlenir.

> **Not:** İş durumu bellek içinde tutulur (`Map`). Üretimde tek süreç / tek makine veya harici bir kuyruk + veritabanı mimarisi düşünülmelidir.

---

## Teknoloji yığını

| Katman | Teknoloji |
|--------|-----------|
| Çerçeve | [Next.js](https://nextjs.org/) 16 (App Router) |
| UI | [React](https://react.dev/) 19, TypeScript |
| Stil | [Tailwind CSS](https://tailwindcss.com/) 4, PostCSS |
| Bileşenler | [shadcn](https://ui.shadcn.com/) ekosistemi, [@base-ui/react](https://base-ui.com/) |
| Yardımcılar | `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` |
| İkonlar | [Lucide React](https://lucide.dev/) |
| Tema | [next-themes](https://github.com/pacocoursey/next-themes) |
| Yazı tipleri | [Geist](https://vercel.com/font) (`next/font`) |
| Konuşma → metin | [OpenAI](https://platform.openai.com/) Transcription API **veya** yerel [Whisper](https://github.com/openai/whisper) CLI |
| Çeviri | [google-translate-api-x](https://www.npmjs.com/package/google-translate-api-x) veya isteğe bağlı [LibreTranslate](https://libretranslate.com/) |
| Medya işleme | [FFmpeg](https://ffmpeg.org/) (sistemde kurulu binary) |
| Diğer | `uuid` (API doğrulama), Node `crypto` (iş kimliği) |

---

## Gereksinimler

| Gereksinim | Açıklama |
|------------|----------|
| **Node.js** | 20.x önerilir (Next.js 16 ile uyumlu bir LTS) |
| **FFmpeg** | `ffmpeg` komutunun PATH’te olması veya `FFMPEG_PATH` ile tam yol |
| **Transkripsiyon** | **Ya** `OPENAI_API_KEY` **ya da** Python ile kurulu `whisper` CLI |
| **Ağ** | Çeviri ve (API kullanılıyorsa) OpenAI için internet |

---

## Kurulum

### 1. Depoyu klonlayın

```bash
git clone <repo-url> sub-frame
cd sub-frame
```

### 2. Bağımlılıkları yükleyin

```bash
npm install
```

### 3. FFmpeg’i kurun

- **macOS (Homebrew):** `brew install ffmpeg`
- **Windows:** [ffmpeg.org](https://ffmpeg.org/download.html) üzerinden indirip PATH’e ekleyin veya `FFMPEG_PATH` kullanın.
- **Linux:** dağıtım paket yöneticisi ile `ffmpeg` paketini kurun.

Kurulumu doğrulayın:

```bash
ffmpeg -version
```

### 4. Ortam değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayın ve düzenleyin:

```bash
cp .env.example .env
```

**Minimum örnek (OpenAI ile):**

```env
OPENAI_API_KEY=sk-...
```

**Yerel Whisper kullanacaksanız** `OPENAI_API_KEY` boş bırakılabilir; bu durumda Python ortamında `whisper` komutunun çalışır olması gerekir (bkz. `.env.example` içindeki `WHISPER_*` değişkenleri).

### 5. Geliştirme sunucusu

```bash
npm run dev
```

Tarayıcıda [http://localhost:3000](http://localhost:3000) adresini açın.

---

## Komutlar

| Komut | Açıklama |
|--------|----------|
| `npm run dev` | Geliştirme sunucusu (hot reload) |
| `npm run build` | Üretim derlemesi |
| `npm run start` | Derlenmiş uygulamayı çalıştırır (`build` sonrası) |
| `npm run lint` | ESLint |

---

## Üretim derlemesi

```bash
npm run build
npm run start
```

Varsayılan port **3000**’dir. Ortamda `PORT` tanımlayarak değiştirebilirsiniz.

---

## Ortam değişkenleri (özet)

Ayrıntılar için `.env.example` dosyasına bakın. Öne çıkanlar:

| Değişken | Rol |
|----------|-----|
| `OPENAI_API_KEY` | OpenAI Whisper API (önerilir; yoksa yerel CLI) |
| `OPENAI_TRANSCRIBE_MODEL` | Örn. `whisper-1` |
| `WHISPER_CMD` / `WHISPER_MODEL` | Yerel Whisper için |
| `FFMPEG_PATH` | FFmpeg’in tam yolu (PATH’te değilse) |
| `LIBRETRANSLATE_URL` | Çeviriyi LibreTranslate’e yönlendirmek için |
| `TRANSLATE_*` | Çeviri gecikmesi, yeniden deneme, TLD |
| `MAX_UPLOAD_BYTES` | Yükleme boyutu üst sınırı (varsayılan 500 MiB) |
| `JOB_TTL_MS` | Tamamlanan iş dosyalarının tutulma süresi |

---

## Dağıtım hakkında

Bu proje **uzun süren işlem**, **büyük dosya yükleme** ve **arka planda pipeline** kullanır. Sunucusuz platformlarda (ör. standart Vercel serverless) süre, dosya boyutu ve arka plan işleri nedeniyle **doğrudan deploy genelde uygun değildir**. Üretim için **sürekli çalışan bir sunucu** (VPS, Railway, Fly.io vb.) veya **nesne depolama + kuyruk + worker** mimarisi düşünülmelidir.

---

## Proje yapısı (kısa)

```
app/           # Sayfalar ve Route Handlers (api/process, api/status, api/download)
components/    # UI bileşenleri (shadcn tabanlı)
lib/           # Dil listesi, iş durumu, pipeline yardımcıları, SRT işleme
workers/       # FFmpeg, Whisper, çeviri
```

---

## Lisans

`package.json` içinde `private: true` olarak işaretlenmiştir; dağıtım ve lisans koşulları proje sahibine aittir.
