/**
 * KURULUM GOLGESI — "calisan kopya gercekten kurdugum kopya mi?"
 *
 * Belirti (08.11.2026, gercek kullanici): `npm install -g residue-cleaner`
 * 3.0.0 kurmasina ragmen `npx residue-cleaner` eski bir surumu aciyordu.
 * Paket kaldirilip yeniden kurulunca hicbir sey degismiyordu.
 *
 * Kanit: npx/npm exec komutu cwd'den yukari yurur ve ilk buldugu
 * `node_modules/.bin` girdisini calistirir. Kullanicinin home dizininde
 * `-g` olmadan kurulmus bir kopya (`C:\Users\<kullanici>\node_modules`)
 * PATH'teki global kopyayi golgeler; `_npx` onbellegi de eski bir kopyayi
 * tutabilir (ayni gun 21.10'dan kalan kopya 3.0.0 yayinlandiktan sonra da
 * calisiyordu).
 *
 * Tasarim: tahmin yok, kanit var. Bu modul yalnizca DISKTEN toplanmis kopya
 * listesini (kok + surum + kapsam) karara cevirir. Toplama isi
 * `util/install-probe.ts`, gosterim `commands/doctor.ts` icindedir.
 *
 * Saf TypeScript: node builtin importu YOKTUR (kural 18).
 */
import { compareVersions } from './semver.ts';

/** Kopyanin nereden geldigi. Adla degil, gozlemle ayrilir. */
export type CopyScope = 'global' | 'local' | 'npx' | 'path';

/** Tek bir kurulum kopyasi (diskten okunan kanit). */
export interface InstalledCopy {
  /** `package.json`un bulundugu klasor. */
  root: string;
  /** Okunamadiysa `null` — surum UYDURULMAZ. */
  version: string | null;
  scope: CopyScope;
  /** Bu kopyayi hangi gozlem gosterdi (kullaniciya kanit olarak gosterilir). */
  evidence: string;
}

/** Su an calisan kopya. */
export interface RunningCopy {
  root: string;
  version: string | null;
}

/** Calisan kopyaya gore durum. */
export type ShadowRelation = 'same' | 'older' | 'newer' | 'unknown';

export interface ShadowFinding {
  scope: CopyScope;
  root: string;
  version: string | null;
  relation: ShadowRelation;
  evidence: string;
}

const SCOPE_LABEL: Record<CopyScope, string> = {
  global: 'global kurulum',
  local: 'yerel proje',
  npx: 'npx onbellegi',
  path: 'PATH girdisi',
};

/** Yolu karsilastirma icin normalestirir: ayirici ve harf farki yok sayilir. */
function normalizeRoot(root: string): string {
  return root.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** `.../<proje>/node_modules/<paket>` -> `.../<proje>` */
function projectDirOf(root: string): string {
  const norm = root.replace(/[\\/]+$/, '');
  const marker = /[\\/]node_modules[\\/][^\\/]+$/i.exec(norm);
  if (!marker) return norm;
  return norm.slice(0, marker.index);
}

export class InstallShadowReport {
  private readonly packageName: string;
  private readonly running: RunningCopy | null;
  private readonly copies: InstalledCopy[];

  constructor(
    packageName: string,
    running: RunningCopy | null,
    copies: readonly InstalledCopy[],
  ) {
    this.packageName = packageName;
    this.running = running;
    this.copies = [...copies];
  }

  /** Iki surum arasindaki ilişki. Surum yoksa `unknown` — tahmin yok. */
  static relation(running: RunningCopy | null, copy: InstalledCopy): ShadowRelation {
    if (!running || !running.version || !copy.version) return 'unknown';
    const c = compareVersions(copy.version, running.version);
    if (c === 0) return 'same';
    return c < 0 ? 'older' : 'newer';
  }

  /** Calisan kopya disindaki tum kopyalar (tekrarlar ve ayni yol elenir). */
  all(): ShadowFinding[] {
    const seen = new Set<string>();
    const runningRoot = this.running ? normalizeRoot(this.running.root) : '';
    const out: ShadowFinding[] = [];
    for (const copy of this.copies) {
      const key = normalizeRoot(copy.root);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Calisan kopyanin kendisi golge DEGILDIR.
      if (runningRoot && key === runningRoot) continue;
      out.push({
        scope: copy.scope,
        root: copy.root,
        version: copy.version,
        relation: InstallShadowReport.relation(this.running, copy),
        evidence: copy.evidence,
      });
    }
    return out;
  }

  /** Yalnizca farkli surumlu / okunamayan kopyalar: bunlar golgedir. */
  findings(): ShadowFinding[] {
    return this.all().filter((f) => f.relation !== 'same');
  }

  status(): 'ok' | 'warn' {
    return this.findings().length === 0 ? 'ok' : 'warn';
  }

  /** Tek satirlik karar metni (doctor tablosunda gorunur). */
  summary(): string {
    const runningVersion = this.running?.version ?? null;
    const findings = this.findings();
    if (findings.length === 0) {
      return runningVersion
        ? `Golge kopya yok (calisan: v${runningVersion})`
        : 'Golge kopya yok (calisan surum okunamadi)';
    }
    const parts = findings.map(
      (f) => `v${f.version ?? '?'} ${SCOPE_LABEL[f.scope]}`,
    );
    const base = runningVersion ? `calisan v${runningVersion}` : 'calisan surum okunamadi';
    return `${findings.length} golge kopya: ${parts.join(', ')} (${base})`;
  }

  /**
   * Yapilacak is: her zaman kopyayi KALDIRMAK degil, dogru kopyayi
   * calistirmak. Komutlar kopyanin kapsamina gore uretilir.
   */
  advice(): string[] {
    const out: string[] = [];
    const findings = this.findings();
    if (findings.length === 0) return out;

    const local = findings.filter((f) => f.scope === 'local');
    const npx = findings.filter((f) => f.scope === 'npx');
    const unknown = findings.filter((f) => f.version === null);
    const runningOlder = findings.some((f) => f.relation === 'newer');

    if (local.length > 0) {
      const dirs = [...new Set(local.map((f) => projectDirOf(f.root)))];
      for (const dir of dirs) {
        out.push(
          `Yerel kopyayi kaldir: npm uninstall ${this.packageName} --prefix "${dir}"`,
        );
      }
    }
    if (runningOlder) {
      out.push(`Guncel kopyayi kur: npm install -g ${this.packageName}@latest`);
    }
    if (npx.length > 0) {
      out.push(`npx kullanirken surum belirt: npx ${this.packageName}@latest <komut>`);
    }
    for (const f of unknown) {
      out.push(`Surumu okunamayan kopya: ${f.root} (${SCOPE_LABEL[f.scope]})`);
    }
    return out;
  }
}
