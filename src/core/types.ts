/**
 * Residue cekirdek tipleri.
 *
 * Tasarim ilkesi: hicbir sey "uygulama adiyla" tanimlanmaz. Bir aday
 * (Candidate) yalnizca gozlenen KANITLARDAN siniflanir. Kanit toplayan
 * katman (Classifier) uygulamanin ne oldugunu bilmez; sadece diskte ne
 * gordugunu raporlar. Karari Evidence -> Verdict katmani verir.
 */

// ---------------------------------------------------------------------------
// Kanit
// ---------------------------------------------------------------------------

/** Bir aday icin toplanan gozlemler. Her alan tek bir kanit turudur. */
export interface Evidence {
  /** Klasor/dosya adi veya log iceriginden cikarilan uygulama kimligi */
  owner?: OwnerSignal;
  /** Klasor icindeki dosya turleri (uzantiya gore sayim) */
  fileKinds?: FileKind[];
  /** Buyuk dosya turleri ornegi (ornegin model agirligi) */
  largeFiles?: LargeFile[];
  /** Ic yapida tespit edilen anlamli alt klasorler */
  markers?: string[];
  /** Klasorun kendi sinyali (adi ne olursa olsun icerik turu) */
  archetype?: Archetype;
  /** Log/manifest iceriginden cikarilan sinyaller */
  logSignals?: LogSignal[];
  /** Son kullanma / yazma zamani */
  lastTouched?: number;
  /** Sahiplik: klasor baska bir kullaniciya mi ait */
  ownerAccount?: string;
  /** Kume icinde tespit edilen bilesik alt parca sayisi (rapor icin) */
  markerSubpartCount?: number;
  /**
   * T32: paket deposunun GERCEK kokü, taranan klasorden farkliysa.
   * Ornek: `%LOCALAPPDATA%\pnpm` bir uygulama klasorudur; depo ise
   * `pnpm\store\v10` altindadir. Silme hedefi bu yol olmalidir.
   */
  cacheRoot?: string;
}

export type OwnerSignal =
  | { kind: 'packageJson'; name: string; version?: string }
  | { kind: 'manifest'; app: string; raw?: string }
  | { kind: 'logFile'; product: string; hint?: string }
  | { kind: 'binaryProduct'; product: string; company?: string }
  | { kind: 'directoryName'; name: string };

export type FileKind =
  | 'onnx-model'
  /** Model agirligi (.gguf / .safetensors) — kok kanitidir tek basina karar degil */
  | 'model-weight'
  | 'cuda-runtime'
  | 'container-image'
  | 'python-env'
  | 'node-modules'
  | 'nuget-package'
  | 'npm-cache'
  | 'venv'
  | 'archive'
  | 'installer'
  | 'crash-dump'
  | 'log'
  | 'sqlite'
  | 'lockfile'
  | 'vpn-config'
  | 'wsl-disk'
  /** Vektor/embedding indeksi (chroma, lance, faiss, npy/parquet) */
  | 'embedding-index'
  /** Herhangi bir native kutuphane — CUDA olmak ZORUNDA DEGIL */
  | 'native-lib';

export interface LargeFile {
  relPath: string;
  bytes: number;
  kind: FileKind;
}

export type Archetype =
  | 'pkg-manager-cache'
  | 'runtime-pool'
  | 'model-store'
  | 'accelerator-runtime'
  | 'agent-workspace'
  | 'electron-app-data'
  | 'editor-extension-store'
  | 'versioned-app-store'
  | 'temp-scratch'
  | 'crash-artifacts'
  | 'updater-staging'
  | 'global-packages'
  /** Kaynak projesi: manifest + bagimlilik klasoru. Kullanici emegi; asla silinmez. */
  | 'project-workspace'
  /** Proje ici bagimlilik klasoru (node_modules / .venv). Yeniden uretilebilir; yalniz raporlanir. */
  | 'project-artifact'
  | 'os-user-data'
  | 'virtual-disk'
  | 'unknown';

/**
 * E11: log isaretinin STABIL karar kimligi.
 *
 * `means` insan okur metindir; tek kelime degisse bile karar sessizce
 * degisebiliyordu. Karar katmani artik yalnizca `kind`e baglanir;
 * `means` yalnizca gosterim ve kanit aciklamasi icin kalir.
 */
export type LogSignalKind =
  | 'model-catalog'
  | 'gpu-provider'
  | 'cpu-device'
  | 'gpu-ep-missing'
  | 'onnx-runtime'
  | 'background-pipe'
  | 'python-env'
  | 'notebook'
  | 'npm-cache'
  | 'nuget-cache'
  | 'wsl';

export interface LogSignal {
  line: string;
  /** Gosterim metni — karar buna baglanmaz (E11). */
  means: string;
  /**
   * Stabil karar kimligi. Eski kanitlar bu alani tasimadigi icin
   * OPSIYONELDIR; `kind` yoksa karar katmani `signalKind()` ile
   * means metninden esler. `classifier.ts` urettigi sinyallerde
   * her zaman dolu.
   */
  kind?: LogSignalKind;
}

// ---------------------------------------------------------------------------
// Aday ve kume
// ---------------------------------------------------------------------------

/** Tek bir disk yolu. Birlestirme bunun uzerinde calisir. */
export interface Part {
  path: string;
  bytes: number;
  files: number;
  lastTouched: number;
  /** Bu parca icinde silinebilecek tahmini bayt */
  reclaimableBytes: number;
  /** Parcanin kayit oldugu yer: 'home' | 'localappdata' | 'roamingappdata' | 'custom' */
  origin: Origin;
  note?: string;
}

export type Origin = 'home' | 'localappdata' | 'roamingappdata' | 'custom';

/**
 * Kume icindeki ayri degerlendirilebilir parca.
 * Bir klasorun icinde hem silinebilir hem KORUNMASI gereken seyler
 * olabilir; bu yuzden karar kume seviyesinde degil parca seviyesinde verilir.
 */
export interface SubPart {
  path: string;
  bytes: number;
  label: string;
  verdictKind: VerdictKind;
  reason: string;
}

/**
 * Dosya bazli silme hedefi.
 *
 * Klasorun TAMAMI her zaman silinmez. Gecici klasorlerde sadece
 * yasli dosyalar, model depolarda sadece bilesik parcalar hedeflenir.
 * `kind` degerleri:
 *   'whole'  -> parcanin tamami (or. NuGet paket onbellegi)
 *   'older'  -> yas filtresiyle (or. Temp'taki 3 gunden eski dosyalar)
 */
export interface DeleteTarget {
  path: string;
  kind: 'whole' | 'older';
  minAgeDays?: number;
  label: string;
  bytes: number;
}

/**
 * Bir "uygulama" kumesi: ayni uygulamanin/env'in bosta kalan parcalari.
 * Ornek: ~/.ornek-uygulama/cache + ~/.ornek-uygulama/ep + Roaming/ornek-uygulama
 */
export interface Cluster {
  /** Kume anahtari: normalize edilmis uygulama adi */
  key: string;
  /** Goruntulenecek baslik, kanitta destekleniyorsa */
  title: string;
  archetype: Archetype;
  parts: Part[];
  /** Kume icinde ayri degerlendirilebilir alt parcalar */
  subparts?: SubPart[];
  /** Gercekten silinecek yollar (onay sonrasi kullanilir) */
  deleteTargets?: DeleteTarget[];
  totalBytes: number;
  reclaimableBytes: number;
  lastTouched: number;
  evidence: Evidence;
  /** Yapisal kanit agaci: Arac -> Aday -> Iddia -> Kanit -> Gozlem. */
  evidenceTree?: import('./evidence-tree.ts').ToolEvidenceNode;
  verdict: Verdict;
}

/**
 * T28: hassas siniflarin plana dahil edilmesi icin ACIK kullanici izni.
 *
 * Bunlar risk seviyesi DEGIL, "plana dahil edilme kapisi"dir:
 * varsayilan olarak report-only kalan sohbet gecmisi, model depolar ve
 * kural dosyalari yalnizca ilgili bayrak verilirse hedeflenir. Iki
 * asamali onay her durumda korunur.
 */
export interface SensitiveAllow {
  history?: boolean;
  models?: boolean;
  rules?: boolean;
}

export type Risk = 'safe' | 'low' | 'medium' | 'high';
export type VerdictKind = 'recommend' | 'ask' | 'report-only' | 'keep';

/**
 * Yeniden uretilebilirlik ekseni (T34). Risk ekseninin YERINE gecmez;
 * ona ikinci bir boyut ekler: "silinirse ne kadar kayip olur?"
 *   - regenerable: yeniden indirilir/uretilir (onbellek, derlenmis ortam)
 *   - user-data:   kullaniciya ait, geri gelmez (oturum, beceri, ayar)
 *   - unknown:     kanit yetersiz; kullanici karar verir
 */
export type Regenerability = 'regenerable' | 'unknown' | 'user-data';

/**
 * Kanit guveni: kac bagimsiz sinyal ayni yone bakiyor.
 *   - high:   yapisal kanit (CACHEDIR.TAG, manifest, imza)
 *   - medium: tek guclu sinyal veya birden fazla zayif sinyal
 *   - low:    yalnizca genel ad/isaret; elle dogrulama gerekir
 */
export type Confidence = 'low' | 'medium' | 'high';

export interface Verdict {
  risk: Risk;
  kind: VerdictKind;
  /** Kullaniciya gosterilecek tek cumle: "bu ne" */
  title: string;
  /** "ne ise yarar" */
  what: string;
  /** "silersem ne olur" */
  consequence: string;
  /** Bu karari hangi kanita dayandirdim */
  because: string[];
  /** Silmeden once yapilmasi gerekenler */
  preconditions: string[];
  /** Yeniden uretilebilirlik ekseni (T34) */
  regenerability: Regenerability;
  /** Kanit guveni (T34) */
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Tarama
// ---------------------------------------------------------------------------

export interface ScanOptions {
  roots: string[];
  envs: Env[];
  minAgeDays: number;
  deep: boolean;
  followLinks: boolean;
}

export type Env =
  | 'dotfolders'
  | 'localappdata'
  | 'roamingappdata'
  | 'pkgcache'
  | 'agent'
  | 'runtime'
  | 'temp'
  | 'vdisk';

export interface EnvDef {
  id: Env;
  label: string;
  description: string;
}

export interface ScanResult {
  startedAt: number;
  finishedAt: number;
  clusters: Cluster[];
  stats: ScanStats;
  skipped: SkippedEntry[];
}

export interface ScanStats {
  rootsScanned: number;
  dirsVisited: number;
  filesSeen: number;
  bytesSeen: number;
  denied: number;
  longPathErrors: number;
}

export interface SkippedEntry {
  path: string;
  reason: 'denied' | 'long-path' | 'link-loop' | 'gone' | 'error';
  /** Hata kodu: yalnizca `reason === 'error'` iken dolu (EBUSY, EMFILE...). */
  code?: string;
}