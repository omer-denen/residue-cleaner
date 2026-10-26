/**
 * Proje durumu — makine tarafindan okunabilir.
 *
 * Amac: yeni bir ajan oturumu "nerede kaldik" sorusunu dosya
 * okuyarak cevaplayabilsin. AGENTS.md insan icin, bu dosya
 * ajanlar icindir.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { longPath } from './longpath.ts';
import { BugViewList } from '../core/bug-view.ts';

export interface TaskState {
  id: string;
  title: string;
  status: 'done' | 'wip' | 'todo' | 'blocked';
  /** Son bilinen durum */
  note?: string;
  /** Nerede kaldik / ne eksik */
  next?: string;
  updatedAt: string;
}

export interface BugEntry {
  /** Kisa baslik */
  title: string;
  /** Belirti (kullaniciya ne yanlis gorundu) */
  symptom: string;
  /** Kok neden */
  cause: string;
  /** Duzeltme */
  fix: string;
  /** Duzeltildi mi */
  status: 'fixed' | 'open' | 'partial';
  /** Onem derecesi: veri kaybi riski var mi */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Bagimsiz calisma dalgasi. Gorev listesi (T*) tek tek isleri tutar;
 * dalga, ayni hedefe yonelik islerin ust grubudur (or. Web UX fazlari,
 * ajan calisma alani motoru).
 */
export interface WaveState {
  id: string;
  title: string;
  status: 'active' | 'done' | 'planned';
  note?: string;
}

export interface ProjectState {
  version: number;
  updatedAt: string;
  project: {
    name: string;
    purpose: string;
    stack: string;
    entry: string;
  };
  /** Paralel yuruyen is gruplari (opsiyonel; eski state dosyalari icermez). */
  waves?: WaveState[];
  /** Calisan komutlar */
  commands: Array<{ cmd: string; desc: string }>;
  tasks: TaskState[];
  bugs: BugEntry[];
  /** Olculmus performans verileri */
  perf: Array<{ what: string; value: string }>;
  /** Dosya sistemi uzerinde yapilan islemler (denetim izi) */
  actionsPerformed: string[];
  /** Su an acik olan kalan isler */
  openQuestions: string[];
}

const STATE_PATH = 'state.json';

export function stateFile(cwd = process.cwd()): string {
  return join(cwd, STATE_PATH);
}

export async function readState(cwd = process.cwd()): Promise<ProjectState | null> {
  try {
    const txt = await readFile(longPath(stateFile(cwd)), 'utf8');
    return JSON.parse(txt) as ProjectState;
  } catch {
    return null;
  }
}

export async function writeState(s: ProjectState, cwd = process.cwd()): Promise<void> {
  s.version = 1;
  s.updatedAt = new Date().toISOString();
  const p = stateFile(cwd);
  await mkdir(longPath(dirname(p)), { recursive: true });
  await writeFile(longPath(p), JSON.stringify(s, null, 2), 'utf8');
}

/** Yeni bir oturum icin ozet uretir. */
export function renderHandoff(s: ProjectState): string {
  const L: string[] = [];
  const wip = s.tasks.filter((t) => t.status === 'wip');
  const todo = s.tasks.filter((t) => t.status === 'todo');
  const bugs = s.bugs ?? [];
  const views = BugViewList.normalize(bugs);
  const openViews = BugViewList.open(bugs);
  const crit = views.filter((b) => b.severity === 'critical' || b.severity === 'high');

  L.push('# Oturum devri');
  L.push('');
  L.push(`Guncelleme: ${s.updatedAt}`);
  L.push('');

  if (s.waves?.length) {
    L.push('## DALGALAR');
    L.push('');
    for (const w of s.waves) {
      const state = w.status === 'done' ? 'tamam' : w.status === 'active' ? 'suruyor' : 'planli';
      L.push(`- **${w.id}** ${w.title} (${state})${w.note ? ` — ${w.note}` : ''}`);
    }
    L.push('');
  }

  if (wip.length) {
    L.push('## YARIDA KALAN ISE');
    L.push('');
    for (const t of wip) {
      L.push(`### [${t.id}] ${t.title}`);
      if (t.note) L.push(`- Durum: ${t.note}`);
      if (t.next) L.push(`- **Siradaki adim**: ${t.next}`);
      L.push('');
    }
  }

  if (crit.length) {
    L.push('## KRITIK / YUKSEK ONCELIKLI HATALAR');
    L.push('');
    for (const b of crit) {
      L.push(`### [${b.severity.toUpperCase()}] ${b.label} (${b.status})`);
      L.push(`- Belirti: ${b.symptom}`);
      L.push(`- Kok neden: ${b.cause}`);
      L.push(`- Duzeltme: ${b.fix}`);
      L.push('');
    }
  }

  if (openViews.length) {
    const other = openViews.filter((b) => b.severity !== 'critical' && b.severity !== 'high');
    if (other.length) {
      L.push('## ACIK HATALAR');
      L.push('');
      for (const b of other) {
        L.push(`- [${b.severity}] ${b.label} — ${b.symptom}`);
      }
      L.push('');
    }
  }

  if (todo.length) {
    L.push('## YAPILMASI PLANLANANLAR');
    L.push('');
    for (const t of todo) L.push(`- [${t.id}] ${t.title}${t.next ? ` — ${t.next}` : ''}`);
    L.push('');
  }

  if (s.perf.length) {
    L.push('## OLCULEN PERFORMANS');
    L.push('');
    for (const p of s.perf) L.push(`- ${p.what}: ${p.value}`);
    L.push('');
  }

  if (s.actionsPerformed.length) {
    L.push('## BU OTURUMDA DIZINE YAPILANLAR');
    L.push('');
    for (const a of s.actionsPerformed) L.push(`- ${a}`);
    L.push('');
  }

  if (s.openQuestions.length) {
    L.push('## ACIK SORULAR');
    L.push('');
    for (const q of s.openQuestions) L.push(`- ${q}`);
    L.push('');
  }

  return L.join('\n');
}