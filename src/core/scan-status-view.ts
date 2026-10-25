import type {
  ScanStatusFacts,
  ScanStatusKind,
  ScanStatusReason,
  ScanStatusRow,
  ScanStatusTone,
  ScanStatusViewResponse,
} from './contract.ts';

/**
 * TARAMA DURUMU GORUNUMU — karar motorunun saf katmani.
 *
 * `ScanFreshness` ("stale") iki FARKLI sebebi tek kelimede birlestirir:
 *
 *  - `expired` : onbellek suresi doldu  -> tarama gercekten eski
 *  - `dirty`   : disk taramadan beri degisti -> sayilar diskle ESLESMIYOR
 *
 * Arayuzde tek basina "Eski" yazan bir rozet ikisini ayirt edemedigi icin
 * yaniltici olur: kullanici "eski bilgi, sorun degil" diye okur, oysa
 * `dirty` durumunda sayilar guvenilmezdir. Bu modul:
 *
 *  1. iki sebebi AYIRIR (`kind`),
 *  2. anlamli bir ton verir (`tone`),
 *  3. nedenleri SIRALAR (`reasons`),
 *  4. detay raporunun satirlarini ve deger turunu secer (`rows`),
 *  5. kullaniciya ne yapilmasi gerektigini belirler (`action`).
 *
 * Arayuz yalnizca bu gorunumu basar; etiket/ton/sira/eylem burada karar
 * verilir. Node builtin importu YOKTUR.
 */
export class ScanStatusView {
  private readonly facts: ScanStatusFacts;

  constructor(facts: ScanStatusFacts) {
    this.facts = facts;
  }

  /** Onbellek suresi doldu mu? */
  private expired(): boolean {
    const { ageMs, ttlMs } = this.facts;
    return ageMs !== null && ageMs > ttlMs;
  }

  /** Iki sebebi ayirt eden durum. */
  private kind(): ScanStatusKind {
    const f = this.facts;
    if (f.scanning) return 'scanning';
    if (f.lastScanAt === null) return 'never';
    const dirty = f.dirty;
    const expired = this.expired();
    if (dirty && expired) return 'dirty-expired';
    if (dirty) return 'dirty';
    if (expired) return 'expired';
    return 'current';
  }

  /** Rozet tonu: ne kadar guvenilmez, o kadar kirmizi. */
  private tone(kind: ScanStatusKind): ScanStatusTone {
    switch (kind) {
      case 'never':
        return 'info';
      case 'current':
        return 'ok';
      case 'expired':
        return 'warn';
      case 'dirty':
        return 'danger';
      case 'dirty-expired':
        return 'danger';
      case 'scanning':
        return 'info';
    }
  }

  /** Detay raporundaki nedenler. Daha guclu sebep once. */
  private reasons(kind: ScanStatusKind): ScanStatusReason[] {
    switch (kind) {
      case 'never':
        return ['never-scanned'];
      case 'current':
        return ['fresh'];
      case 'expired':
        return ['expired'];
      case 'dirty':
        return ['dirty'];
      case 'dirty-expired':
        return ['dirty', 'expired'];
      case 'scanning':
        return ['scanning'];
    }
  }

  /**
   * Detay raporunun satirlari. Deger turu de motor secer; arayuz yalnizca
   * bicimlendirir.
   */
  private rows(): ScanStatusRow[] {
    const f = this.facts;
    const out: ScanStatusRow[] = [];

    if (f.lastScanAt !== null) {
      out.push({ id: 'lastScan', amount: f.lastScanAt, unit: 'timestamp' });
    }
    if (f.ageMs !== null) {
      out.push({ id: 'age', amount: f.ageMs, unit: 'duration' });
    }
    out.push({ id: 'ttl', amount: f.ttlMs, unit: 'duration' });
    if (f.nextRecommendedAt !== null) {
      out.push({ id: 'nextRecommended', amount: f.nextRecommendedAt, unit: 'timestamp' });
    }
    if (f.clusters !== null) {
      out.push({ id: 'scope', amount: f.clusters, unit: 'count' });
    }

    const disk = f.disk;
    if (disk) {
      out.push({ id: 'diskDrive', text: disk.drive });
      out.push({ id: 'diskTotal', amount: disk.totalBytes, unit: 'bytes' });
      out.push({ id: 'diskFree', amount: disk.freeBytes, unit: 'bytes' });
      out.push({ id: 'diskUsed', amount: disk.usedRatio, unit: 'ratio' });
    }

    return out;
  }

  /** Kullaniciya ne yapilmali? Guncel ve taraniyor durumlarinda eylem yok. */
  private action(kind: ScanStatusKind): 'scan' | 'none' {
    return kind === 'current' || kind === 'scanning' ? 'none' : 'scan';
  }

  view(): ScanStatusViewResponse {
    const kind = this.kind();
    return {
      kind,
      tone: this.tone(kind),
      reasons: this.reasons(kind),
      rows: this.rows(),
      action: this.action(kind),
      showAge: this.facts.ageMs !== null,
    };
  }
}

/** Ham gerceklerden gorunum uretir (servis katmani bunu kullanir). */
export function scanStatusView(facts: ScanStatusFacts): ScanStatusViewResponse {
  return new ScanStatusView(facts).view();
}
