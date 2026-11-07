/**
 * DURUM ISKELETI — `state.json` yazma karari (B18).
 *
 * Eski `scripts/init-state.ts` 10 gorevlik 2025 sablonunu kosulsuz
 * yaziyordu: `npm run init-state` calistiginda 98 gorevlik gercek durum
 * dosyasinin uzerine geciyordu (veri kaybi). Ayni risk
 * `status --init` icin de gecerliydi.
 *
 * Kural:
 *   - Dosya yoksa iskelet yazilir (ilk kurulum).
 *   - Dosya varsa **sessizce ezilmez**; `--force` istenir.
 *   - `--force` ile yazarken once `state.json.bak-<zaman>` yedegi alinir.
 *
 * Bu modul saf TypeScript'tir: node builtin importu YOKTUR, dosya okumaz.
 * Karar burada; `src/util/state.ts` yalnizca uygular.
 */
import type { ProjectState } from '../util/state.ts';

/** Mevcut durum dosyasinin ozeti (kullaniciya "ne kaybolacak" demek icin). */
export interface ExistingStateFacts {
  tasks: number;
  bugs: number;
  updatedAt?: string;
}

export type ScaffoldReason = 'missing' | 'exists' | 'forced';

export interface ScaffoldDecision {
  /** Yazmaya izin var mi */
  allowed: boolean;
  /** missing: dosya yok · exists: dolu dosya reddedildi · forced: yedekle uzerine yaz */
  reason: ScaffoldReason;
  /** Mevcut dosyanin ozeti (yoksa veya okunamiyorsa null) */
  existing: ExistingStateFacts | null;
}

export class StateScaffold {
  /** Mevcut durumun sayilabilir ozeti; bozuk/eksik alanlar 0 sayilir. */
  static facts(existing: ProjectState | null): ExistingStateFacts | null {
    if (!existing) return null;
    const tasks = Array.isArray(existing.tasks) ? existing.tasks.length : 0;
    const bugs = Array.isArray(existing.bugs) ? existing.bugs.length : 0;
    const updatedAt = typeof existing.updatedAt === 'string' ? existing.updatedAt : undefined;
    return { tasks, bugs, updatedAt };
  }

  /**
   * @param present Dosya diskte var mi (bozuk JSON da "var" sayilir).
   * @param existing Okunabilen durum; okunamiyorsa null.
   */
  static decide(present: boolean, existing: ProjectState | null, force = false): ScaffoldDecision {
    if (!present) return { allowed: true, reason: 'missing', existing: null };
    const facts = StateScaffold.facts(existing);
    if (!force) return { allowed: false, reason: 'exists', existing: facts };
    return { allowed: true, reason: 'forced', existing: facts };
  }

  /** Yedek dosya adi eki: dosya sisteminde guvenli zaman damgasi. */
  static backupSuffix(now: Date): string {
    return now
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/Z$/, 'Z');
  }

  /** Kullaniciya gosterilecek tek cumlelik karar metni (ASCII). */
  static describe(d: ScaffoldDecision): string {
    if (d.reason === 'missing') return 'state.json yok: iskelet durum dosyasi yaziliyor.';
    const ozet = d.existing
      ? `${d.existing.tasks} gorev, ${d.existing.bugs} hata`
      : 'icerigi okunamayan dosya';
    if (d.reason === 'exists') {
      return `state.json zaten dolu (${ozet}) — uzerine YAZILMADI. Sifirlamak icin --force (once yedek alinir).`;
    }
    return `state.json uzerine yaziliyor (${ozet}) — once yedek alinacak.`;
  }

  /** Ilk kurulum iskeleti: gorev/hata listesi BOS (gecmis uydurulmaz). */
  static skeleton(): ProjectState {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      project: {
        name: 'Residue',
        purpose: 'Disk artiklarini kanitlarla listeleyen, secimini kullaniciya onaylatan temizleyici',
        stack: 'TypeScript + Node 24 + Ink/React (tsx runner)',
        entry: 'src/cli.ts',
      },
      waves: [],
      commands: [
        { cmd: 'node bin/residue.mjs scan', desc: 'Tara ve listele' },
        { cmd: 'node bin/residue.mjs ui', desc: 'Terminal TUI (Ink; TTY gerektirir)' },
        { cmd: 'node bin/residue.mjs api --port 4321', desc: 'Basisz HTTP/SSE API' },
        { cmd: 'node bin/residue.mjs clean --dry-run', desc: 'Yalniz plan, silme yok' },
        { cmd: 'node bin/residue.mjs clean', desc: 'Iki asamali onay + kasa' },
        { cmd: 'node bin/residue.mjs inventory --verbose', desc: 'Kurulu CLI envanteri + atillik kaniti' },
        { cmd: 'node bin/residue.mjs explain <ad>', desc: 'Karar gerekcesini kanitlarla goster' },
        { cmd: 'node bin/residue.mjs log --summary', desc: 'Gunluk ozeti' },
        { cmd: 'node bin/residue.mjs doctor', desc: 'Ortam kontrolu' },
        { cmd: 'node bin/residue.mjs status', desc: 'Proje durumu' },
      ],
      tasks: [],
      bugs: [],
      perf: [],
      actionsPerformed: [],
      openQuestions: [],
    };
  }
}
