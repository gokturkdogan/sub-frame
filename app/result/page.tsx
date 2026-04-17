import { Suspense } from "react";

import { ResultClient } from "./result-client";

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground">
      Yükleniyor…
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ResultClient />
    </Suspense>
  );
}
