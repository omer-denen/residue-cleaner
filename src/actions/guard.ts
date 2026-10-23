import { resolve, sep } from 'node:path';
import type { DeleteTarget } from '../core/types.ts';
import { isOwnDataPath, isProtectedUserPath } from '../core/discover.ts';

/**
 * Silme hedefi guvenlik kapisi.
 *
 * Neden gerekli: tarama katmani bir hata yaparsa (or. bir kok klasoru
 * yanlis siniflandirirsa) silme katmani bunu "olculmus hedef" diye
 * kabul etmemelidir. Burada LEXIK bir kontrol yapilir; dosya sistemine
 * dokunulmaz. Korumali yollarin ATASI olan bir hedef her zaman
 * reddedilir:
 *
 *   C:\Users\Code            -> reddedilir (home'un ust klasoru)
 *   C:\Users\Code\AppData    -> reddedilir (%LOCALAPPDATA%/Roaming'in atasi)
 *   C:\Program Files\nodejs  -> reddedilir (calisan node.exe'nin atasi)
 *   C:\                     -> reddedilir (surucu koku)
 *
 * Hedefin kendisi korumali yolsa da reddedilir. Korunan yolun ALTINDAKI
 * bir hedef serbesttir: or. %LOCALAPPDATA%\Temp.
 */

function norm(p: string): string {
  const r = resolve(p);
  // Surucu koku "C:\" -> sondaki ayirici korunur; digerlerinde kaldirilir.
  return (r.length > 3 ? r.replace(/[\\/]+$/, '') : r).toLowerCase();
}

function isSameOrAncestor(ancestor: string, child: string): boolean {
  if (ancestor === child) return true;
  const prefix = ancestor.endsWith(sep) ? ancestor : ancestor + sep;
  return child.startsWith(prefix);
}

/** Bu makinede asla silme hedefi olamayacak yollar. */
export function protectedPaths(): string[] {
  const env = process.env;
  const candidates: Array<string | undefined> = [
    process.execPath,
    process.cwd(),
    env.SystemRoot,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramData,
    env.LOCALAPPDATA,
    env.APPDATA,
    env.USERPROFILE,
    // Aracin kendi verisi (gunluk, kasa) korunur: `%LOCALAPPDATA%\residue`.
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\residue` : undefined,
  ];
  return candidates.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/** Hedef guvenli mi? Guvenliyse null, degilse gerekce doner. */
export function unsafeTargetReason(target: string): string | null {
  const t = norm(target);

  // Surucu koku (C:\, D:\) hicbir zaman silinmez. `norm` surucu
  // kokunde sondaki ayiriciyi KORUR; bu yuzden iki bicim de kontrol edilir.
  if (/^[a-z]:(?:[\\/])?$/.test(t)) return 'surucu koku hedeflenemez';

  // Aracin KENDI veri dizini (kasa, gunluk, karantina) ve ALTINDAKI
  // her sey korunur: kullanicinin geri donus adimlari orada yasar.
  if (isOwnDataPath(t)) return 'aracin kendi veri dizini (kasa/gunluk) korunur';

  // Kimlik bilgisi klasorleri kullanici degeridir; "onbellek" gibi
  // gorunen alt dosyalar olsa bile silinmez (D8).
  if (isProtectedUserPath(t)) return 'kimlik bilgisi klasoru (.ssh/.gnupg/.aws/.azure/.kube) korunur';

  for (const p of protectedPaths()) {
    const pp = norm(p);
    if (t === pp) return `korunan yol: ${p}`;
    // t, korunan yolun ust klasoru ise o korunan yol da silinirdi.
    if (isSameOrAncestor(t, pp)) return `korunan bir yolun ust klasoru: ${p}`;
  }
  return null;
}

/** Hedefi dogrular; guvensizse hata firlatir. */
export function assertSafeTarget(target: DeleteTarget): void {
  const reason = unsafeTargetReason(target.path);
  if (reason) {
    throw new Error(`Guvenlik reddi: "${target.path}" silinemez — ${reason}`);
  }
}
