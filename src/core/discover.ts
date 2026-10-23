import { realpathSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, win32 } from 'node:path';
import { longPath } from '../util/longpath.ts';
import { DATA_DIR_NAME } from './data-dir.ts';
import type { Env, EnvDef, Part, SkippedEntry } from './types.ts';

/** Ortam tanimlari: --env secimi ve profil sistemi bunlari kullanir. */
export const ENVS: EnvDef[] = [
  {
    id: 'dotfolders',
    label: 'Nokta klasorleri',
    description: 'Kullanici dizinindeki tum . ile baslayan klasorler',
  },
  {
    id: 'localappdata',
    label: 'LocalAppData',
    description: 'Yerel uygulama verisi ve onbellekler',
  },
  {
    id: 'roamingappdata',
    label: 'RoamingAppData',
    description: 'Kullanici profiliyle tasinan uygulama verileri',
  },
  {
    id: 'pkgcache',
    label: 'Paket onbellekleri',
    description: 'npm / NuGet / conda / uv onbellekleri',
  },
  {
    id: 'agent',
    label: 'AI ajan artiklari',
    description: 'Ajan oturum gecmisi, beceri ve onbellekleri',
  },
  {
    id: 'runtime',
    label: 'Runtime havuzlari',
    description: 'Derlenmis yorumlayici ortamlari',
  },
  {
    id: 'temp',
    label: 'Gecici dosyalar',
    description: 'Yalnizca %TEMP% koku ve cokme dokumleri',
  },
  {
    id: 'vdisk',
    label: 'Sanal diskler',
    description: 'WSL / Docker / VM diskleri (sadece raporlanir)',
  },
];

/** Kaydedilebilir profiller. */
export interface Profile {
  name: string;
  description: string;
  envs: Env[];
  /** Bu profilde gizli tutulacak yol parcalari (alt dizin adlari) */
  exclude?: string[];
  /**
   * Salt okunur profil: tarama yapar, KANIT uretir ama silme hedefi
   * uretmez. Karar katmani (`classifyPath`) bunu zorunlu kilar.
   */
  readOnly?: boolean;
}

export const BUILTIN_PROFILES: Record<string, Profile> = {
  lean: {
    name: 'lean',
    description: 'Sadece guvenli onbellekler (agresif temizlik)',
    // NOT: `Temp` dislama listesinden KALDIRILDI. Dislama, %TEMP% kokunun
    // kendisini de eliyordu (yolun son parcasi "Temp"); boylece `temp`
    // ortami lean profilinde hic taranmiyordu. Genel AppData taramasinda
    // %LOCALAPPDATA%\Temp zaten PROTECTED_ROOTS ile atlanir; acikca
    // istenen %TEMP% koku ise guvenli (yas sinirli) hedeftir.
    envs: ['pkgcache', 'temp'],
  },
  audit: {
    name: 'audit',
    description: 'Her seyi raporla, hicbir sey silme',
    envs: ['dotfolders', 'localappdata', 'roamingappdata', 'agent', 'runtime', 'vdisk'],
    readOnly: true,
  },
  full: {
    name: 'full',
    description: 'Tum kategoriler, risk duzeyine gore onayla',
    envs: ['dotfolders', 'localappdata', 'roamingappdata', 'pkgcache', 'agent', 'runtime', 'temp', 'vdisk'],
  },
};

/**
 * GENEL taramada asla dokunulmayacak kokler.
 *
 * Bunlar kullanici verisi veya uygulama kurulumudur; "gereksiz
 * artik" kavramina girmezler. Liste kurala degil, SEMANTIGE gore
 * kurulur: bir klasorun ne oldugu bilinmeden "artik" denemez.
 *
 * Kural: bu liste KESIF kapisidir, guvenlik garantisi degildir.
 * Silme kapisi `actions/guard.ts`'tir; oradaki koruma her durumda
 * gecerlidir. Bilincli istisna: `vdisk` ortami WSL dagitim disklerini
 * (`Packages\*\LocalState`, `wsl\*`) DAR bir kesifle bulur; bu koku
 * siniflandirma `virtual-disk` yapar ve hedef uretmez.
 */
const PROTECTED_ROOTS = new Set([
  'programs',
  'windows',
  'microsoft',
  'packages',
  'wsl',
  'comms',
  'connecteddevicesplatform',
  'virtualstore',
  'temp',
  'roaming',
  'local',
]);

/**
 * Kimlik bilgisi tasiyan nokta klasorleri: aday OLMAZ.
 *
 * Bu klasorler kullanici degeri ve guvenlik acisindan kritiktir; icinde
 * "onbellek" gibi gorunen dosyalar olsa bile hedef uretilmez. Kural
 * yalnizca keşifte degil, `classifyPath` ve `guard.ts` icinde de uygulanir.
 */
const PROTECTED_DOT = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube']);

/** Dizin listesi: hata ve link bilgisi kaybolmasin (sessiz "0 klasor" yok). */
interface DirList {
  names: string[];
  /** Erisim reddedildi (EACCES/EPERM) */
  denied: boolean;
  /** Kok hic yok (ENOENT) */
  missing: boolean;
  /** Junction/symlink olan girdiler: hedef DEGIL, raporlanir */
  links: string[];
}

export interface DiscoveryResult {
  targets: Array<{ path: string; origin: Part['origin'] }>;
  stats: { dotDirs: number; localDirs: number; roamingDirs: number; denied: number };
  /** Kesifte atlanan yollar (erisim/link). Tarama sonucuna akar. */
  skipped: SkippedEntry[];
  /** Kullaniciya gosterilecek uyarilar (kok okunamadi, izin yok...). */
  warnings: string[];
  /** Taranmayan ama diskte olan sanal diskler (varsa). */
  virtualDisks: string[];
}

/**
 * Aracin KENDI veri dizinleri (gunluk, kasa, karantina, tarama onbellegi).
 *
 * Bunlar tarama hedefi OLAMAZ: kullanici "artik" sanip silerse yedek
 * kasasi, gunluk defteri ve geri donus adimlari kaybolur. Yol adi
 * sabit kodlanmaz; ortam degiskenlerinden turetilir.
 *
 * Tek veri dizini: `%LOCALAPPDATA%\residue` (ve `~/.residue`).
 */
export function ownDataDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const local = env.LOCALAPPDATA ?? '';
  const home = env.USERPROFILE ?? env.HOME ?? '';
  if (local) {
    out.push(join(local, DATA_DIR_NAME));
  }
  if (home) {
    out.push(join(home, `.${DATA_DIR_NAME}`));
  }
  return out;
}

/**
 * Yol karsilastirmasi icin tek bicim.
 *
 * Windows'ta ayni klasor birden cok yazimla gelebilir:
 *
 *   C:/Users/x/AppData/Local/residue
 *   c:\users\x\appdata\local\residue\
 *   \\?\C:\Users\x\AppData\Local\residue
 *   C:\Users\x\AppData\Local\RESIDU~1      (8.3 kisa ad)
 *
 * Karsilastirma normalize + mumkunse `realpath` (junction/8.3 cozumu) +
 * kucuk harf uzerinden yapilir. Aksi halde kasa dizini "artik" sanilip
 * taranabilir (D6).
 */
function normalizeForCompare(p: string): string {
  let s = p.trim().replace(/\//g, '\\');
  s = s.replace(/^\\\\\?\\UNC\\/i, '\\\\');
  s = s.replace(/^\\\\\?\\/i, '');
  s = s.replace(/^\\\\\.\\/i, '');
  s = s.replace(/\\{2,}/g, '\\');
  const resolved = win32.resolve(s);
  let real = resolved;
  try {
    real = realpathSync.native(resolved);
  } catch {
    /* yol yok: lexik bicim yeterli */
  }
  return win32.normalize(real).replace(/\\+$/, '').toLowerCase();
}

/** Yol, aracin kendi veri dizini mi (kendisi veya altinda)? */
export function isOwnDataPath(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!path) return false;
  const p = normalizeForCompare(path);
  return ownDataDirs(env).some((d) => {
    const dir = normalizeForCompare(d);
    if (!dir) return false;
    return p === dir || p.startsWith(`${dir}\\`);
  });
}

/**
 * Kimlik bilgisi klasoru mu (`.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`)?
 * Yolun HERHANGI bir parcasi eslesirse korunur; alt yollar da guvenli.
 */
export function isProtectedUserPath(path: string): boolean {
  if (!path) return false;
  const parts = path.replace(/\//g, '\\').split('\\').filter(Boolean);
  return parts.some((seg) => PROTECTED_DOT.has(seg.toLowerCase()));
}

/**
 * Korunan hedefleri ayiklar: aracin kendi veri dizini ve kimlik bilgisi
 * klasorleri. Ters yon korumasidir (D7): tarama koku kasayi ICERIYORSA
 * (or. `--root %LOCALAPPDATA%`) alt hedefler arasinda kasa yolu kalabilir.
 */
export function filterProtectedTargets<T extends { path: string }>(
  targets: T[],
  env: NodeJS.ProcessEnv = process.env,
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const t of targets) {
    if (isOwnDataPath(t.path, env) || isProtectedUserPath(t.path)) removed.push(t);
    else kept.push(t);
  }
  return { kept, removed };
}

/**
 * Kesif: taranacak kokleri bul.
 *
 * Onemli: burada HICBIR uygulama adi sabit kodlu degildir. Tum
 * $HOME altindaki ".*" klasorleri ve AppData'nin tum cocuklari aday
 * olarak toplanir. Uygulamanin ne oldugunu daha sonra kanit katmani
 * belirler.
 */
export async function discover(
  envs: Env[],
  opts: { exclude?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<DiscoveryResult> {
  const env = opts.env ?? process.env;
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const local = env.LOCALAPPDATA ?? '';
  const roaming = env.APPDATA ?? '';
  const excluded = new Set((opts.exclude ?? []).map((e) => e.toLowerCase()));

  const targets: DiscoveryResult['targets'] = [];
  const stats = { dotDirs: 0, localDirs: 0, roamingDirs: 0, denied: 0 };
  const skipped: SkippedEntry[] = [];
  const warnings: string[] = [];
  const virtualDisks: string[] = [];

  const want = (e: Env) => envs.includes(e);

  /** Dizin listesinin hata/link bilgisini istatistige ve uyariya cevir. */
  const noteList = (label: string, root: string, list: DirList): void => {
    if (!root) {
      warnings.push(`${label}: ortam degiskeni bos`);
      return;
    }
    if (list.missing) warnings.push(`${label}: klasor bulunamadi (${root})`);
    if (list.denied) {
      stats.denied++;
      warnings.push(`${label}: erisim reddedildi (${root})`);
    }
    for (const name of list.links) {
      // Junction/symlink: arkasindaki hedef taranmaz, ama sessizce de
      // yutulmaz. "link" olarak raporlanir (D9).
      skipped.push({ path: join(root, name), reason: 'link-loop' });
    }
  };

  // --- $HOME altindaki nokta klasorleri ---
  if (want('dotfolders') || want('agent') || want('runtime') || want('pkgcache')) {
    const list = await listDirs(home);
    noteList('Kullanici dizini', home, list);
    for (const name of list.names) {
      if (!name.startsWith('.')) continue;
      if (excluded.has(name.toLowerCase())) continue;
      // Kimlik bilgisi klasorleri aday olmaz (D8).
      if (isProtectedUserPath(join(home, name))) continue;
      if (isOwnDataPath(join(home, name))) continue;
      stats.dotDirs++;
      targets.push({ path: join(home, name), origin: 'home' });
    }
  }

  // --- AppData ---
  //
  // DIKKAT: `temp` ve `vdisk` burada YOKTUR. Ikisi de kendi dar
  // kesifleriyle eklenir; aksi halde "--env temp" tum LocalAppData'yi
  // tarardi (D1) ve sanal disk ortami en buyuk diskleri goremezdi.
  if (want('localappdata') || want('pkgcache') || want('agent') || want('runtime')) {
    const list = await listDirs(local);
    noteList('LocalAppData', local, list);
    for (const name of list.names) {
      if (excluded.has(name.toLowerCase())) continue;
      if (PROTECTED_ROOTS.has(name.toLowerCase())) continue;
      if (isOwnDataPath(join(local, name))) continue;
      stats.localDirs++;
      targets.push({ path: join(local, name), origin: 'localappdata' });
    }
  }
  if (want('roamingappdata') || want('agent') || want('runtime')) {
    const list = await listDirs(roaming);
    noteList('RoamingAppData', roaming, list);
    for (const name of list.names) {
      if (excluded.has(name.toLowerCase())) continue;
      if (PROTECTED_ROOTS.has(name.toLowerCase())) continue;
      // Tasan dongu de kendi verisini korur (D10).
      if (isOwnDataPath(join(roaming, name))) continue;
      stats.roamingDirs++;
      targets.push({ path: join(roaming, name), origin: 'roamingappdata' });
    }
  }

  // --- Acikca bilinen paket yoneticisi / runtime kokleri ---
  // Bunlar AppData'nin korunan cocuklari (Microsoft, .local vb.) altinda
  // kaldigi icin genel taramada gorunmez; --env secimine gore eklenir.
  const seen = new Set(targets.map((t) => resolve(t.path).toLowerCase()));
  const addExtra = async (paths: Array<string | undefined>, origin: Part['origin']) => {
    for (const p of paths) {
      if (!p) continue;
      const abs = resolve(p);
      const key = abs.toLowerCase();
      if (seen.has(key) || isOwnDataPath(abs) || isProtectedUserPath(abs)) continue;
      if (excluded.has(abs.split(/[\\/]/).pop()?.toLowerCase() ?? '')) continue;
      try {
        if (!(await stat(longPath(abs))).isDirectory()) continue;
      } catch {
        continue;
      }
      seen.add(key);
      targets.push({ path: abs, origin });
    }
  };

  if (want('temp') && env.TEMP) {
    // PROTECTED_ROOTS 'temp'i genel taramada atlar; acikca istenince
    // yalnizca %TEMP% koku eklenir (tum AppData taranmaz).
    await addExtra([env.TEMP], 'custom');
  }

  if (want('vdisk')) {
    // WSL dagitim diskleri genel taramada korunan klasorlerin altinda
    // kalir (Packages, wsl). Bu yuzden DAR bir kesif yapilir: yalnizca
    // ICINDE .vhd/.vhdx bulunan dagitim klasoru aday olur. Siniflandirma
    // bu koku `virtual-disk` yapar; silme hedefi URETILMEZ.
    const containers = [join(local, 'Packages'), join(local, 'wsl')];
    for (const d of await findVirtualDiskDirs(containers)) {
      virtualDisks.push(d);
      await addExtra([d], 'custom');
    }
  }

  // NOT: winget/scoop/choco/pipx gibi KURULUM kokleri burada diske
  // taranmaz; CLI envanteri onlari salt okunur listeler. Boylece
  // "kurulu arac" yanlislikla "artik" sayilmaz.

  return { targets, stats, skipped, warnings, virtualDisks };
}

const VIRTUAL_DISK_RE = /\.(vhd|vhdx)$/i;

/**
 * Sanal disk ICEREN klasorleri bulur (WSL dagitimlari).
 *
 * Yalnizca `<konteyner>\<dagitim>\LocalState` ve `<konteyner>\<dagitim>`
 * iki seviyesi okunur; UWP uygulama verisi taranmaz. Donen yol, disk
 * dosyasini ICEREN klasordur; boylece `virtual-disk` kaniti kokte olusur.
 */
export async function findVirtualDiskDirs(containers: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const container of containers) {
    const list = await listDirs(container);
    for (const name of list.names) {
      const distro = join(container, name);
      for (const candidate of [join(distro, 'LocalState'), distro]) {
        const ents = await readdir(longPath(candidate), { withFileTypes: true }).catch(() => null);
        if (ents?.some((e) => e.isFile() && VIRTUAL_DISK_RE.test(e.name))) {
          out.push(candidate);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Dizinleri listeler; HATA ve LINK bilgisi kaybolmaz.
 *
 * Eski davranis her hatada `[]` donuyordu: erisilemeyen bir kok
 * "0 klasor" gibi gorunuyor, `stats.denied` hic artmiyordu (D9).
 * Junction/symlink girdileri hedef yapilmaz ama raporlanir.
 */
async function listDirs(root: string): Promise<DirList> {
  const empty: DirList = { names: [], denied: false, missing: false, links: [] };
  if (!root) return { ...empty, missing: true };
  try {
    const ents = await readdir(longPath(root), { withFileTypes: true });
    const names: string[] = [];
    const links: string[] = [];
    for (const e of ents) {
      let isDir = false;
      try {
        isDir = e.isDirectory();
      } catch {
        isDir = false;
      }
      if (e.isSymbolicLink()) {
        links.push(e.name);
        continue;
      }
      if (isDir) names.push(e.name);
    }
    return { names, denied: false, missing: false, links };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ...empty,
      denied: code === 'EACCES' || code === 'EPERM',
      missing: code === 'ENOENT',
    };
  }
}
