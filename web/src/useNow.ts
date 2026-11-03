import { useEffect, useState } from 'react';

/**
 * Gorunum saati — yas etiketleri ("12 gun once") kendiliginden tazelenir.
 *
 * Yalnizca BICIMLENDIRME icin: sunucudan yeni istek yapmaz, karar uretmez
 * (AGENTS.md kural 18). Varsayilan 30 sn; saniyelik sayaclar kendi
 * `useNow`larini kullanir.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
