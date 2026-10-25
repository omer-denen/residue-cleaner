/**
 * CLI envanteri veri modeli.
 *
 * Bu dosyada Node'a ait HICBIR calisma zamani importu yoktur; hem
 * sunucu hem tarayici arayuzu ayni tipleri kullanir.
 */

export type CliSource = 'npm-global' | 'uv-tool' | 'dotnet-tool' | 'pip-user' | 'standalone';
export type CliStatus = 'unused' | 'recent' | 'unknown' | 'protected';

/** T69/F5: tipli kanit sinyali turleri. */
export type UsageSignal = 'state' | 'history' | 'atime' | 'install';
/** T35: ayni dizinin birden fazla PATH kaynaginda tanimli olmasi. */
export interface PathDuplicate {
  path: string;
  sources: Array<'user' | 'machine'>;
  detail: string;
}

/** T36: Node surum yoneticisi turu (yapidann taninir, addan degil). */
export type NodeRuntimeKind = 'nvm' | 'fnm' | 'volta' | 'unknown';

/** T36: tek bir Node surum kopyasi. Silme hedefi DEGILDIR. */
export interface NodeRuntimeCopy {
  version: string;
  nodeExe: string;
  dir: string;
  kind: NodeRuntimeKind;
  /** Calisan node.exe veya PATH bu kopyayi gosteriyor mu? */
  active: boolean;
  /** Surumun global paket klasoru (varsa). */
  globalModules: string | null;
  /** npm/corepack disindaki global paket sayisi. */
  globalPackageCount: number;
  lastTouched: number;
  /** Aktif degil + global paket var: inceleme gerekli (otomatik secilmez). */
  review: boolean;
}

/** T36: surum yoneticisi kokleri ve kopyalari (SALT OKUNUR). */
export interface NodeRuntimeReport {
  roots: Array<{ path: string; kind: NodeRuntimeKind }>;
  copies: NodeRuntimeCopy[];
  activeVersion: string | null;
  note?: string;
}

/** T35: User (HKCU) ve Machine (HKLM) PATH kaynaklari. SALT OKUNUR. */
export interface PathSourceReport {
  userDirs: string[];
  machineDirs: string[];
  /** process.env.PATH icindeki tekil dizin sayisi */
  mergedDirs: number;
  duplicates: PathDuplicate[];
  /** Kayit defterinde tanimli ama diskte olmayan dizinler */
  missing: Array<{ path: string; source: 'user' | 'machine' }>;
  /** Kayit defteri okunamazsa gerekce */
  note?: string;
}

/**
 * T33: bir araci baska bir yerden kullanan kanit.
 *
 * Referans/surec varsa kaldirma guveni dusurulur; bu bir SILME karari
 * degildir, yalnizca "once bunu kaldir/kapat" uyarisidir.
 */
export interface CliReference {
  kind: 'process' | 'config' | 'shortcut' | 'scheduled-task';
  /** Surec adi, dosya yolu veya gorev adi */
  path: string;
  detail: string;
}

export interface UninstallSpec {
  kind: 'npm' | 'uv' | 'dotnet' | 'pip' | 'manual';
  program: string;
  args: string[];
  /** Kullaniciya gosterilecek komut */
  display: string;
}

export interface CliTool {
  id: string;
  command: string;
  source: CliSource;
  packageName: string;
  version: string;
  installPath: string;
  shims: string[];
  /**
   * PATH'teki shim'in gosterdigi hedef (npm icin). Ayni komutu birden
   * fazla paket sagladiginda hangisinin gercekten cagrildigini kanitlar.
   */
  shimTarget?: string;
  /** Shim bu kurulumu mu gosteriyor? (false = golgede kalan eski kurulum) */
  activeShim?: boolean;
  /** Ayni kurulumun icinde kalan eski surum yollari (or. .store) */
  stalePaths: string[];
  stateDirs: string[];
  installedAt: number;
  lastAccessAt: number;
  lastStateAt: number;
  historyMentions: number;
  /** Kabuk gecmisindeki son bahsin konumu (1 = en son satirlar) */
  historyLastRatio: number;
  totalBytes: number;
  idleDays: number;
  status: CliStatus;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  /** T69/F5: karara giren tipli kanit sinyalleri (sabit sira). */
  usageSignals: UsageSignal[];
  /** T69/F5: atime kurulum anıyla aynı → kullanım kanıtı sayılmadı. */
  atimeSuspect: boolean;
  uninstall: UninstallSpec | null;
  /**
   * Kurulum sagligi. 'broken' = bin dosyasi stub kalmis / calismiyor;
   * genellikle npm'in kurulum betiklerini engellemesinden kaynaklanir.
   */
  health?: 'ok' | 'broken';
  healthEvidence?: string[];
  /** Bozuk kurulumu paket yoneticisiyle onaracak komut. */
  repair?: UninstallSpec;
  /** T17: npm kurulum gunlugunden kurulum izi (varsa). */
  installTrace?: InstallTrace;
  /** T33: araci kullanan surec/dosya/gorev referanslari (SALT OKUNUR). */
  references?: CliReference[];
}

/**
 * Ayni komutun birden fazla kaynaktan kurulmasi.
 *
 * "Birlestirme" karari burada VERILMEZ; yalnizca hangi kurulumun
 * tutulacagi kanitla onerilir.
 */
export interface CliDuplicates {
  command: string;
  keepId: string;
  removeIds: string[];
  /** Aktif shim'in isaret ettigi kurulum (varsa). */
  activeId?: string;
  reason: string;
}

/**
 * T17: shim agi ile kurulumlar arasindaki tutarsizliklar.
 *
 * Otomatik silme YOKTUR; yalnizca kanit olarak raporlanir.
 */
export interface ShimIssue {
  kind: 'orphan-shim' | 'missing-shim' | 'empty-scope';
  /** Sorunlu dosya ya da beklenen shim yolu. */
  path: string;
  command?: string;
  packageName?: string;
  detail: string;
}

/**
 * T17: PATH'te ayni komutun birden fazla girdisi.
 *
 * entries PATH sirasina gore dizilmistir: ilki gercekten calisan,
 * kalanlar golgede kalan olu agirliklardir.
 */
export interface PathShadow {
  command: string;
  entries: Array<{ path: string; label: string }>;
  /** `where` ile dogrulanan gercek PATH sirasi (varsa). */
  detail: string;
}

/**
 * T17: npm kurulum gunlugunden (`_logs`) cikan kurulum izi.
 *
 * "Ajan kurmus olabilir" kaniti burada uretilir; uygulama adi gecmez,
 * yalnizca kurulum saati, komut ve cwd (ve varsa yapisal izler) yazilir.
 */
export interface InstallTrace {
  at: number;
  /** Ornek: `npm install -g foo` */
  command: string;
  cwd?: string;
  /** cwd icinde beceri/oturum gibi yapisal izler bulunduysa aciklama. */
  agentHint?: string;
  logFile: string;
}

export interface CliInventory {
  scannedAt: number;
  unusedDays: number;
  tools: CliTool[];
  duplicates: CliDuplicates[];
  roots: string[];
  notes: string[];
  /** T17: oksuz / eksik shim ve bos scope sorunlari. */
  shimIssues: ShimIssue[];
  /** T17: PATH'te golgede kalan komut girdileri. */
  pathShadows: PathShadow[];
  /** T35: User / Machine PATH kaynaklari ve cakismalar (SALT OKUNUR). */
  pathChannels?: PathSourceReport;
  /** T36: Node surum yoneticisi kopyalari (SALT OKUNUR, silme hedefi yok). */
  nodeRuntimes?: NodeRuntimeReport;
}

export interface CliInventoryOptions {
  unusedDays?: number;
  now?: number;
  /**
   * Her arac bulundugu anda cagrilir. Web arayuzu bunu SSE ile
   * canli akitir; toplu sonucu beklemez.
   */
  onTool?: (tool: CliTool) => void;
  /** Envanter taramasini iptal etmek icin. */
  signal?: AbortSignal;
}
