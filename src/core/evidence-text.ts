import type { Cluster } from './types.ts';

/**
 * KANIT YORUMU.
 *
 * Deterministik "kanit yorumu" (T42 / D3 P2). Bu metin bir dil modeli
 * ciktisi DEGILDIR: kume kanitindan (mimari tip, dosya turu, isaretler,
 * karar eksenleri) uretilen sabit bir ozet. Amac "ne bulduk ve ne olur"
 * sorusunu tek cumlede yanitlamaktir.
 *
 * Kurallar:
 *   - Her cumle bir kanita dayanir.
 *   - Kanit yoksa cumle uretilmez ("bilinmiyor" denmez, sessizce atlanir).
 *   - Silme karari bu metinden cikarilmaz; karar `verdict` alanindadir.
 *
 * NOT (T42 / D3 P6): metinler su an TR sabittir ve i18n katmanindan gecmez.
 * Cok dilli surum icin metin uretimi yapilandirilabilir hale getirilebilir.
 * Bu modul CANLI TARAYICIYA bagimLI DEGILDIR: saf TypeScript, node builtin
 * importu yok — CLI/TUI ile web ayni dosyayi paylasabilir.
 */

const ARCHETYPE_TEXT: Record<string, string> = {
  'pkg-manager-cache': 'Paket yoneticisi onbellegi: indirilen paketler tekrar indirilebilir.',
  'runtime-pool': 'Derlenmis yorumlayici ortami: yeniden kurulabilir, ancak calisan projeleri bozabilir.',
  'model-store': 'Model dosyalari: yeniden indirilmesi buyuk indirme gerektirir.',
  'accelerator-runtime': 'GPU hizlandirici runtime: uygulamanin kullandigi paylasilan dosyalar.',
  'agent-workspace': 'Ajan calisma alani: beceri ve plan dosyalari kullanici degeridir, korunur.',
  'electron-app-data': 'Uygulama onbellegi: ayarlar ve oyun verisi KORUNUR, yalnizca onbellek hedeflenir.',
  'editor-extension-store': 'Editor eklenti deposu: etkin surum manifestten anlasilir.',
  'versioned-app-store': 'Surumlu uygulama deposu: en guncel surum korunur, eskiler aday olur.',
  'temp-scratch': 'Gecici dosya alani: yas filtresiyle hedeflenir.',
  'crash-artifacts': 'Cokme dumpleri: hata ayiklama icin tutulur.',
  'updater-staging': 'Guncelleyici artigi: yarim kalmis guncelleme dosyalari.',
  'global-packages': 'Global paket kurulumu: komut shimleri bu klasorde yasar.',
  'project-workspace': 'Proje calisma alani: kullanici emegi, ASLA silinmez.',
  'project-artifact': 'Proje ici bagimlilik: lockfile ile yeniden kurulabilir, yalniz raporlanir.',
  'os-user-data': 'Kullanici verisi: geri gelmez.',
  'virtual-disk': 'Sanal disk: ASLA otomatik silinmez.',
  unknown: 'Kanit yetersiz: yalniz raporlanir.',
};

const REGEN_TEXT: Record<string, string> = {
  regenerable: 'Yeniden uretilebilir: silinince yeniden kurulur/indirilir.',
  'user-data': 'Kullanici verisi: silinince geri gelmez.',
  unknown: 'Yeniden uretilebilirlik belirsiz: once icerigi incele.',
};

const RISK_TEXT: Record<string, string> = {
  safe: 'Risk dusuk: onbellegi yeniden uretilir.',
  low: 'Risk dusuk.',
  medium: 'Risk orta: silmeden once icerigi kontrol et.',
  high: 'Risk yuksek: silmek ciddi sonuc dondurur.',
};

export class EvidenceReader {
  private readonly cluster: Cluster;

  constructor(cluster: Cluster) {
    this.cluster = cluster;
  }

  /** Kume Git tarafindan takip edilen yollar iceriyor mu? */
  static isGitTracked(cluster: Cluster): boolean {
    return (cluster.evidence.markers ?? []).includes('git-tracked');
  }

  /**
   * Sahiplik kanitinin kisa etiketi.
   *
   * Ad, surum ve urun alanlari kanittan gelir; arayuz yalnizca gosterir.
   */
  static ownerLabel(owner: NonNullable<Cluster['evidence']['owner']>): string {
    switch (owner.kind) {
      case 'packageJson':
        return owner.version ? `${owner.name}@${owner.version}` : owner.name;
      case 'manifest':
        return owner.app;
      case 'logFile':
        return owner.product;
      case 'binaryProduct':
        return owner.product;
      case 'directoryName':
        return owner.name;
      default:
        return '';
    }
  }

  /**
   * Kume icin kanit cumleleri.
   *
   * Her cumle bir kanita dayanir; kanit yoksa cumle uretilmez.
   */
  reading(): string[] {
    const c = this.cluster;
    const out: string[] = [];
    const arch = c.evidence.archetype ?? c.archetype;

    const archText = ARCHETYPE_TEXT[arch];
    if (archText) out.push(archText);

    const kinds = c.evidence.fileKinds ?? [];
    if (kinds.includes('onnx-model')) out.push('Icinde model agirligi (onnx) dosyalari var.');
    if (kinds.includes('embedding-index'))
      out.push('Icinde vektor/embedding indeksi var; yeniden indeksleme pahali olabilir.');
    if (kinds.includes('cuda-runtime')) out.push('Icinde CUDA runtime dosyalari var (GPU hizlandirici).');
    if (kinds.includes('crash-dump')) out.push('Icinde cokme dumpleri var.');
    if (kinds.includes('node-modules')) out.push('Icinde bagimlilik klasoru var (node_modules).');

    const markers = c.evidence.markers ?? [];
    if (EvidenceReader.isGitTracked(c))
      out.push('Sürüm kontrolü altındaki yollar atlandı; tracked dosyalar silinmez.');
    if (markers.includes('CACHEDIR.TAG'))
      out.push('Klasor kendini onbellek olarak isaretliyor (CACHEDIR.TAG).');

    const regen = c.verdict.regenerability;
    if (regen) {
      const regenText = REGEN_TEXT[regen];
      if (regenText) out.push(regenText);
    }

    const riskText = RISK_TEXT[c.verdict.risk];
    if (riskText) out.push(riskText);

    if (c.verdict.kind === 'report-only') out.push('Otomatik silinmez; yalniz raporlanir.');
    if (c.verdict.kind === 'keep') out.push('Korunuyor: kullanici degeri.');

    const targets = c.deleteTargets ?? [];
    if (targets.length > 0) {
      const whole = targets.filter((t) => t.kind === 'whole').length;
      const older = targets.length - whole;
      const parcalar: string[] = [];
      if (whole > 0) parcalar.push(`${whole} klasorun tamami`);
      if (older > 0) parcalar.push(`${older} yasli dosya kumesi`);
      out.push(`Plana alinabilecek hedef: ${parcalar.join(' ve ')}.`);
    }

    const logSignals = c.evidence.logSignals ?? [];
    if (logSignals.length > 0)
      out.push('Gunluk sinyalleri bulundu; karar bu sinyallerden biriyle destekleniyor.');

    return out;
  }
}
