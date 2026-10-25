import { ScanSummary } from './scan-summary.ts';
import { DefaultSelection } from './selection.ts';
import { categoryOf } from './categories.ts';
import type {
  DashboardCardView,
  DashboardDetailView,
  DashboardLedgerView,
  DashboardResponse,
  DashboardSafeWinView,
  DashboardScanView,
  DashboardTotalsView,
  ScanStatusViewResponse,
} from './contract.ts';
import type { Cluster } from './types.ts';

/**
 * BASLANGIC OZETI (dashboard) — KARAR MOTORU.
 *
 * Korunan/geri kazanilabilir toplamlar, risk kartlari ve "guvenli
 * kazanimlar" burada hesaplanir. Arayuz yalnizca kimlikleri metne
 * cevirir ve baytlari bicimlendirir; HICBIR hesap yapmaz.
 *
 * Kural: agir tarama TETIKLENMEZ. Girdi, servis katmaninin onbellekten
 * topladigi gerceklerdir (`DashboardFacts`).
 *
 * Bu modul SAF TypeScript'tir: node builtin importu YOKTUR.
 */

export interface DashboardFacts {
  now: number;
  scan: {
    state: 'never' | 'current' | 'stale' | 'scanning';
    at: number | null;
    ageMs: number | null;
    scanning: boolean;
    clusters: Cluster[];
    /** Motorun ayristirilmis tarama durumu (kartlar da bunu kullanir). */
    view: ScanStatusViewResponse;
  };
  /** Disk + CLI bulgu toplamlari (envanter onbellegi varsa). */
  inventory: {
    diskBytes: number;
    diskCount: number;
    cliBytes: number;
    cliCount: number;
    brokenInstalls: number;
    /** CLI envanteri gercekten tarandi mi? (0 B ile "bilinmiyor" farki) */
    cliKnown: boolean;
  } | null;
  env: {
    pathIssues: number;
    orphanVars: number;
    shadowedCommands: number;
  } | null;
  graph: {
    broken: number;
    critical: number;
    shadowed: number;
  } | null;
  recover: { interrupted: number };
  vault: { entries: number; bytes: number; expired: number; lastAt: number | null };
  /** Kayitli plan sayilari (rozet icin). */
  schedules: { rules: number; due: number; missed: number };
  /** Kart detaylari (secilen kartin satirlari). */
  details: DashboardDetailView[];
}

/** Ayni anda gosterilecek "guvenli kazanim" sayisi. */
const SAFE_WIN_LIMIT = 5;

export class DashboardSummary {
  private readonly facts: DashboardFacts;

  constructor(facts: DashboardFacts) {
    this.facts = facts;
  }

  private summary(): ScanSummary {
    return new ScanSummary(this.facts.scan.clusters);
  }

  scan(): DashboardScanView {
    const s = this.summary();
    return {
      state: this.facts.scan.state,
      at: this.facts.scan.at,
      ageMs: this.facts.scan.ageMs,
      scanning: this.facts.scan.scanning,
      clusters: this.facts.scan.clusters.length,
      files: s.fileCount(),
      view: this.facts.scan.view,
    };
  }

  /**
   * Iki defterin bakiyesi.
   *
   * `protected` = taranan toplam - geri kazanilabilir. Bu sayi "sizin
   * veriniz" iddiasidir; proje artefaktlari da buradadir.
   */
  ledgers(): DashboardLedgerView[] {
    const totals = this.summary().totals();
    const inv = this.facts.inventory;
    return [
      {
        id: 'protected',
        bytes: Math.max(0, totals.totalBytes - totals.reclaimableBytes),
        known: true,
        detailId: 'ledger-protected',
      },
      {
        id: 'reclaimable',
        bytes: totals.reclaimableBytes,
        known: true,
        detailId: 'ledger-reclaimable',
      },
      { id: 'vault', bytes: this.facts.vault.bytes, known: true, detailId: 'ledger-vault', count: this.facts.vault.entries },
      {
        id: 'cli',
        bytes: inv?.cliBytes ?? 0,
        // Envanter hic taranmadiysa 0 B "bos" degil "bilinmiyor" demektir.
        known: inv?.cliKnown ?? false,
        detailId: 'ledger-cli',
      },
    ];
  }

  /**
   * Risk kartlari. Sira kararlidir: once tarama tazeligi, sonra para
   * kaybettiren riskler, en son bilgi kartlari.
   */
  cards(): DashboardCardView[] {
    const out: DashboardCardView[] = [];
    const { scan, env, graph, recover, vault, schedules, inventory } = this.facts;

    // Tarama karti: "stale" iki sebebi birlestirir; ayrim motorun kararidir.
    // `dirty` (disk degisti) ile `expired` (sure doldu) AYRI kart olur.
    // KART = KONU ("Onceki Tarama") + SONUC ("Disk degisti").
    // Bu kartlar SAYI tasimaz -> count = null ("-" gosterilir).
    switch (scan.view.kind) {
      case 'never':
        out.push({
          id: 'scan-missing',
          tone: 'info',
          titleId: 'scan',
          stateId: 'scan-missing',
          detailId: 'scan',
          count: null,
          target: 'disk',
          meta: { at: scan.at, ageMs: scan.ageMs },
        });
        break;
      case 'expired':
        out.push({
          id: 'scan-stale',
          tone: 'warn',
          titleId: 'scan',
          stateId: 'scan-stale',
          detailId: 'scan',
          count: null,
          target: 'disk',
          meta: { at: scan.at, ageMs: scan.ageMs },
        });
        break;
      case 'dirty':
      case 'dirty-expired':
        out.push({
          id: 'scan-dirty',
          tone: 'danger',
          titleId: 'scan',
          stateId: 'scan-dirty',
          detailId: 'scan',
          count: null,
          target: 'disk',
          meta: { at: scan.at, ageMs: scan.ageMs },
        });
        break;
      case 'current':
      case 'scanning':
        break;
    }

    if (inventory && inventory.brokenInstalls > 0) {
      out.push({
        id: 'broken-installs',
        tone: 'danger',
        titleId: 'installs',
        stateId: 'broken-installs',
        detailId: 'installs',
        count: inventory.brokenInstalls,
        target: 'tools',
      });
    }

    if (graph && graph.broken > 0) {
      out.push({
        id: 'broken-dependencies',
        tone: 'danger',
        titleId: 'deps',
        stateId: 'broken-dependencies',
        detailId: 'deps',
        count: graph.broken,
        target: 'graph',
      });
    }

    if (env && env.pathIssues > 0) {
      out.push({
        id: 'path-issues',
        tone: 'warn',
        titleId: 'paths',
        stateId: 'path-issues',
        detailId: 'paths',
        count: env.pathIssues,
        target: 'env',
      });
    }

    if (env && env.shadowedCommands > 0) {
      out.push({
        id: 'shadowed-commands',
        tone: 'warn',
        titleId: 'commands',
        stateId: 'shadowed-commands',
        detailId: 'commands',
        count: env.shadowedCommands,
        target: 'env',
      });
    }

    if (env && env.orphanVars > 0) {
      out.push({
        id: 'orphan-vars',
        tone: 'info',
        titleId: 'vars',
        stateId: 'orphan-vars',
        detailId: 'vars',
        count: env.orphanVars,
        target: 'env',
      });
    }

    if (recover.interrupted > 0) {
      out.push({
        id: 'interrupted',
        tone: 'danger',
        titleId: 'recover',
        stateId: 'interrupted',
        detailId: 'recover',
        count: recover.interrupted,
        // "Kurtarma" icin ekran yok (yalniz CLI komutu) -> hedef yok.
        target: null,
      });
    }

    if (vault.expired > 0) {
      out.push({
        id: 'vault-expired',
        tone: 'info',
        titleId: 'vault',
        stateId: 'vault-expired',
        detailId: 'vault',
        count: vault.expired,
        target: 'vault',
      });
    }

    if (schedules.missed > 0) {
      out.push({
        id: 'schedule-missed',
        tone: 'warn',
        titleId: 'schedules',
        stateId: 'schedule-missed',
        detailId: 'schedules',
        count: schedules.missed,
        target: 'schedules',
      });
    }

    if (schedules.due > 0) {
      out.push({
        id: 'schedule-due',
        tone: 'info',
        titleId: 'schedules',
        stateId: 'schedule-due',
        detailId: 'schedules',
        count: schedules.due,
        target: 'schedules',
      });
    }

    return out;
  }

  /**
   * Varsayilan secim kuralini (T34) gecen kumeler.
   *
   * Kural TEK yerde: `DefaultSelection`. Arayuz kendi "guvenli" listesini
   * uretemez. "Neden" metni yerine kategori + yeniden uretilebilirlik +
   * guven kimligi doner; ceviri arayuzdedir.
   */
  safeWins(limit = SAFE_WIN_LIMIT): DashboardSafeWinView[] {
    const out: DashboardSafeWinView[] = [];
    for (const c of this.facts.scan.clusters) {
      if (!DefaultSelection.selected(c)) continue;
      out.push({
        clusterKey: c.key,
        // Okunabilir ad: ham anahtar ("local:dir:rattler") kullaniciya bir sey
        // anlatmaz; Disk ekranindaki baslikla ayni olmalidir.
        title: c.title,
        category: categoryOf(c),
        bytes: c.reclaimableBytes,
        regenerability: c.verdict.regenerability,
        confidence: c.verdict.confidence,
      });
    }
    out.sort((a, b) => b.bytes - a.bytes);
    return out.slice(0, limit);
  }

  totals(): DashboardTotalsView {
    const s = this.summary();
    const clusters = this.facts.scan.clusters;
    const scannedBytes = clusters.reduce((sum, c) => sum + (c.totalBytes ?? 0), 0);
    const deletableBytes = clusters.reduce((sum, c) => sum + (c.reclaimableBytes ?? 0), 0);
    return {
      clusters: s.all.length,
      files: s.fileCount(),
      verdicts: s.verdictCounts(),
      scannedBytes,
      deletableBytes,
    };
  }

  view(): DashboardResponse {
    return {
      generatedAt: this.facts.now,
      scan: this.scan(),
      ledgers: this.ledgers(),
      cards: this.cards(),
      safeWins: this.safeWins(),
      totals: this.totals(),
      details: this.facts.details,
      lastVaultAt: this.facts.vault.lastAt,
    };
  }
}
