/**
 * CLI JSON adaptoru — SAF TypeScript, node builtin YOK.
 *
 * `residue scan --json` ciktisinin SEKILlendirmesi burada. Karar mantigi
 * YOKTUR; yalnizca ScanResult'i makine-okunur JSON'a cevirir. CLI ve
 * parity testleri ayni fonksiyonu kullanir (sessiz sapma riski olmaz).
 */
import type { ScanResult } from './types.ts';

/** `residue scan --json` ciktisi (arayuz adaptoru; karar YOK). */
export function scanJson(r: ScanResult) {
  return {
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    stats: r.stats,
    clusters: r.clusters.map((c) => ({
      key: c.key,
      title: c.title,
      archetype: c.archetype,
      totalBytes: c.totalBytes,
      reclaimableBytes: c.reclaimableBytes,
      lastTouched: c.lastTouched,
      verdict: c.verdict,
      evidence: c.evidence,
      parts: c.parts.map((p) => ({
        path: p.path,
        bytes: p.bytes,
        files: p.files,
        origin: p.origin,
      })),
      // Silme hedefleri ve alt parcalar da makine okunur ciktida
      // bulunmali; aksi halde "onerilen ama hedefsiz" gibi gorunur.
      deleteTargets: (c.deleteTargets ?? []).map((t) => ({
        path: t.path,
        kind: t.kind,
        bytes: t.bytes,
        label: t.label,
        minAgeDays: t.minAgeDays,
      })),
      subparts: (c.subparts ?? []).map((s) => ({
        path: s.path,
        label: s.label,
        bytes: s.bytes,
        verdictKind: s.verdictKind,
        reason: s.reason,
      })),
    })),
  };
}