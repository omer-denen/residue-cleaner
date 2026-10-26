import { readState, writeState, renderHandoff, type ProjectState } from '../util/state.ts';
import { info } from '../util/log.ts';
import { BugViewList } from '../core/bug-view.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

/** `residue status` — projenin nereye kadar geldigini gosterir. */
export async function runStatus(args: string[]): Promise<void> {
  const cwd = process.cwd();

  if (args.includes('--init')) {
    await writeState(initialState(cwd));
    console.log(`${C.green}state.json olusturuldu.${C.reset}`);
    return;
  }

  if (args.includes('--export')) {
    const s = await readState(cwd);
    if (!s) {
      console.log(`${C.yellow}state.json yok. Once "residue status --init" calistir.${C.reset}`);
      return;
    }
    process.stdout.write(renderHandoff(s));
    return;
  }

  const s = await readState(cwd);
  if (!s) {
    console.log(`${C.yellow}Durum dosyasi yok: state.json${C.reset}`);
    console.log(`${C.dim}Olusturmak icin: residue status --init${C.reset}\n`);
    return;
  }

  const wip = s.tasks.filter((t) => t.status === 'wip');
  const done = s.tasks.filter((t) => t.status === 'done');
  const todo = s.tasks.filter((t) => t.status === 'todo');
  const open = BugViewList.open(s.bugs);
  const counts = BugViewList.counts(s.bugs);

  console.log(`\n${C.bold}${s.project.name}${C.reset} ${C.gray}— ${s.project.purpose}${C.reset}`);
  console.log(`${C.dim}Guncelleme: ${s.updatedAt}${C.reset}`);
  if (s.waves?.length) {
    const label = s.waves
      .map((w) => `${w.id} ${w.status === 'done' ? 'tamam' : w.status === 'active' ? 'suruyor' : 'planli'}`)
      .join(' · ');
    console.log(`${C.dim}Dalgalar: ${label}${C.reset}`);
  }
  console.log('');

  console.log(`  ${C.green}${done.length} tamamlandi${C.reset} · ${C.yellow}${wip.length} yarida${C.reset} · ${C.gray}${todo.length} planli${C.reset}`);
  if (open.length > 0) {
    console.log(`  ${C.red}${open.length} acik hata${C.reset}${counts.critical ? ` (${counts.critical} kritik)` : ''}${counts.high ? ` (${counts.high} yuksek)` : ''}`);
  }
  console.log('');

  if (wip.length) {
    console.log(`${C.bold}YARIDA KALAN${C.reset}`);
    for (const t of wip) {
      console.log(`  ${C.yellow}*${C.reset} ${C.bold}${t.id}${C.reset} ${t.title}`);
      if (t.next) console.log(`    ${C.dim}sonraki: ${t.next}${C.reset}`);
    }
    console.log('');
  }

  if (open.length) {
    console.log(`${C.bold}ACIK HATALAR${C.reset}`);
    for (const b of open.slice(0, 6)) {
      const col = b.severity === 'critical' ? C.red : b.severity === 'high' ? C.yellow : C.gray;
      const idPart = b.id ? `[${b.id}] ` : '';
      console.log(`  ${col}!${C.reset} [${b.severity}] ${idPart}${b.label}`);
    }
    if (open.length > 6) console.log(`  ${C.dim}... +${open.length - 6}${C.reset}`);
    console.log('');
  }

  if (todo.length) {
    console.log(`${C.bold}PLANLANAN${C.reset}`);
    for (const t of todo.slice(0, 8)) {
      console.log(`  ${C.gray}[${t.id}] ${t.title}${C.reset}`);
    }
    console.log('');
  }

  console.log(`${C.dim}Detay: residue status --export${C.reset}`);
  console.log(`${C.dim}Gunluk: residue log --summary${C.reset}\n`);

  info('status goruntulendi', { done: done.length, wip: wip.length, todo: todo.length, acikHata: open.length });
}

function initialState(cwd: string): ProjectState {
  void cwd;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    project: {
      name: 'Residue',
      purpose: 'Disk artiklarini kanitlarla listeleyen, secimini kullaniciya onaylatan temizleyici',
      stack: 'TypeScript + Node 24 + Ink/React (tsx runner)',
      entry: 'src/cli.ts',
    },
    commands: [
      { cmd: 'node bin/residue.mjs scan', desc: 'Tara ve listele' },
      { cmd: 'node bin/residue.mjs ui', desc: 'Terminal TUI (Ink)' },
      { cmd: 'node bin/residue.mjs clean', desc: 'Iki asamali onay + geri donusum kutusu' },
      { cmd: 'node bin/residue.mjs explain <ad>', desc: 'Karar gerekcesini kanitlarla goster' },
      { cmd: 'node bin/residue.mjs log --summary', desc: 'Gunluk ozeti' },
      { cmd: 'node bin/residue.mjs doctor', desc: 'Ortam kontrolu' },
    ],
    tasks: [],
    bugs: [],
    perf: [],
    actionsPerformed: [],
    openQuestions: [],
  };
}