/**
 * GOREV GORUNUMU — durum semasi hijyeni.
 *
 * `state.json` icindeki `tasks[].status` degeri zamanla genisledi:
 *   - `done`    : bitti
 *   - `wip`     : yarida
 *   - `todo`    : planlandi, baslanmadi
 *   - `planned` : planlandi (arayuz/dokuman dili; `todo` ile ayni anlam)
 *   - `blocked` : disari bagimli, bekliyor
 *
 * Onceki surumler yalnizca `todo` sayiyordu; `planned` yazan bir gorev
 * (or. T64) sayaclarda **gorunmuyordu** — "0 planli" derken acik is vardi.
 * Cozum: acik kume tek yerde tanimlanir; **taninmayan** durum da sayilir,
 * sessizce kaybolmaz.
 *
 * Bu modul saf TypeScript'tir: node builtin importu YOKTUR. Karar mantigi
 * burada; `status.ts` ve `renderHandoff` yalniz gosterir.
 */
export type TaskStatus = 'done' | 'wip' | 'todo' | 'planned' | 'blocked';

/** Girdi: alanlarin hepsi opsiyonel (bozuk/eski state dosyalari). */
export interface TaskLike {
  id?: string;
  title?: string;
  status?: string;
  note?: string;
  next?: string;
}

/** Henuz bitmemis gorev durumlari. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'planned', 'blocked'];

const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>([
  'done',
  'wip',
  'todo',
  'planned',
  'blocked',
]);

export interface TaskCounts {
  total: number;
  done: number;
  wip: number;
  open: number;
  /** Taninmayan `status` degerleri (or. yazim hatasi) — kaybolmaz, raporlanir. */
  unknown: number;
}

export class TaskViewList {
  static isKnown(status: string | undefined): boolean {
    return status !== undefined && KNOWN_STATUSES.has(status);
  }

  static isOpen(status: string | undefined): boolean {
    if (status === undefined) return false;
    return OPEN_TASK_STATUSES.some((s) => s === status);
  }

  static counts(tasks: readonly TaskLike[]): TaskCounts {
    let done = 0;
    let wip = 0;
    let open = 0;
    let unknown = 0;
    for (const t of tasks) {
      if (t.status === 'done') done++;
      else if (t.status === 'wip') wip++;
      else if (this.isOpen(t.status)) open++;
      else unknown++;
    }
    const total = tasks.length;
    return { total, done, wip, open, unknown };
  }

  static open<T extends TaskLike>(tasks: readonly T[]): T[] {
    return tasks.filter((t) => this.isOpen(t.status));
  }

  static wip<T extends TaskLike>(tasks: readonly T[]): T[] {
    return tasks.filter((t) => t.status === 'wip');
  }

  static unclassified<T extends TaskLike>(tasks: readonly T[]): T[] {
    return tasks.filter((t) => !this.isKnown(t.status));
  }
}
