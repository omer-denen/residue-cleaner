#!/usr/bin/env node
import { runScan, renderReport } from './commands/scan.ts';
import { currentVersion } from './util/version.ts';
import { runClean } from './commands/clean.ts';
import { runExplain } from './commands/explain.ts';
import { runDoctor } from './commands/doctor.ts';
import { runUndo } from './commands/undo.ts';
import { runRules } from './commands/rules.ts';
import { runLog, runLogSummary } from './commands/log.ts';
import { runStatus } from './commands/status.ts';
import { runInventory } from './commands/inventory.ts';
import { runRepair } from './commands/repair.ts';
import { runQuarantine } from './commands/quarantine.ts';
import { ENVS, BUILTIN_PROFILES } from './core/discover.ts';
import type { Env } from './core/types.ts';
import { scanJson } from './core/cli-json.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function printHelp(): void {
  console.log(`
${C.bold}Residue${C.reset} — disk artiklarini kanitlarla listeler, secimini sen onaylarsin

${C.bold}Baslamak icin${C.reset}
  ${C.cyan}residue scan${C.reset}             Terminalde tara ve listele
  ${C.cyan}residue clean --dry-run${C.reset}  Plani goster; hicbir sey silme

${C.bold}Gelismis${C.reset}
  residue ui                  Terminal arayuzu (Ink; gercek terminal gerekir)
  residue ui --web            Tarayici arayuzu (dist/web; 127.0.0.1)
  residue clean                Iki asamali onay + kasa (geri alinabilir)
  residue inventory [...]      Kurulu CLI envanteri (salt okunur)
  residue repair [--only <ad>] Bozuk / yarim kurulumlari onar (ONAR onayi)
  residue quarantine <ad>     Bagimsiz araci kasaya tasi (KARANTINA onayi, geri alinabilir)
  residue explain <ad>         Bir kumenin karar gerekcesi
  residue undo [--restore]     Son silmeyi geri al
  residue vault                Kasa envanteri / saklama / kalici silme
  residue recover              Yarim kalan islemleri raporla (journal)
  residue env                  Ortam degiskenleri / PATH analizi (salt okunur)
  residue project [dir]        Proje bagimliliklari ve yeniden kurulum tarifi
  residue graph                CLI bagimlilik grafigi + what-if
  residue schedule             Planli kasa temizligi (gunluk/haftalik)
  residue api [--port <n>]     BASSSIZ HTTP/SSE API (arayuz yok; 127.0.0.1)
  residue log [--summary]      Gunluk
  residue doctor               Ortam kontrolu
  residue rules                Kural listesi
  residue status               Proje durumu (gelistirici)

${C.bold}Ortam secimi${C.reset}  ${C.gray}(--env ile birden fazla)${C.reset}
${ENVS.map((e) => `  ${C.cyan}${e.id.padEnd(16)}${C.reset}${e.label.padEnd(26)}${C.gray}${e.description}${C.reset}`).join('\n')}

${C.bold}Profiller${C.reset}
${Object.values(BUILTIN_PROFILES).map((p) => `  ${C.cyan}${p.name.padEnd(16)}${C.reset}${p.description}`).join('\n')}

${C.bold}Secenekler${C.reset}
  --env <ad>         Ortam filtresi (tekrar edilebilir). Varsayilan: tumu
  --profile <ad>     Kayitli profil kullan (lean, audit, full)
  --min-age <gun>    Bu yastan eskiyse sadece raporla
  --exclude <ad>     Haric tut (nokta klasoru veya AppData adi)
  --root <dir>       Proje ici artiklar: yalnizca bu dizinin alt klasorleri
                     taranir; tekrar edilebilir; sonuclar report-only olur
  --all              Tum kumeleri goster (varsayilan ilk 25)
  --json             Makine okunur JSON
  --quiet            Ilerleme cubugu gosterme
  -h, --help         Bu yardim

${C.bold}Sadece clean icin${C.reset}
  --purge            Geri donusum kutusu yerine KALICI sil
  --only <ad>        Sadece bu kume/anahtari temizle (tekrar edilebilir)
  --dry-run          Sadece plani goster, hicbir sey silme
  -y, --yes          Onay sormadan calistir

${C.bold}Hassas siniflar (yalnizca acikca istenirse)${C.reset}
  --clear-history    Sohbet/oturum gecmisi klasorlerini plana dahil et
  --nuke-models      TUM model depolarini plana dahil et (DANGER)
  --reset-rules      Kural dosyalarini plana dahil et (rules/*.rules)
  ${C.gray}Not: bu bayraklar risk sinifini DEGISTIRMEZ; iki asamali onay korunur.${C.reset}

${C.bold}Sadece api icin${C.reset}
  --port <n>         Sabit port (varsayilan: bos port otomatik secilir)
  ${C.gray}Not: API arayuz sunmaz. Yalnizca HTTP/SSE uzerinden servis katmanina erisir.${C.reset}

${C.bold}Sadece inventory icin${C.reset}
  --unused <gun>     Atillik esigi (varsayilan: 21 gun)
  --all              Yakin/korunan araclari da listele
  --verbose          Kanitlari ve kaldirma komutlarini goster
  --json             Makine okunur JSON
  --report <dosya.md>  Paylasilabilir Markdown raporu yaz

${C.bold}Ornekler${C.reset}
  residue scan --env pkgcache
  residue clean --env pkgcache
  residue clean --only nuget --purge
  residue inventory --unused 21 --verbose
  residue inventory --report envanter.md
  residue scan --profile audit --json
  residue scan --root C:\\projeler\\uygulamam    Proje ici artiklari tara (rapor)
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Sürüm: ag isteği YAPMAZ; sadece paketin sürümünü okur.
  // NOT: bu bayraklar '-' ile basladigi icin komut cozumlemesinden ONCE
  // kontrol edilir (aksi halde varsayilan komut (yardim) calisir).
  if (argv.length > 0 && (argv[0] === '-v' || argv[0] === '--version' || argv[0] === 'version')) {
    console.log(currentVersion());
    return;
  }

  // Komut verilmezse yardim metni gosterilir: hicbir sey baslatilmaz.
  // (2.0.0: varsayilan giris artik tarayici arayuzu degil.)
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;

  if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
    printHelp();
    return;
  }

  if (cmd === 'scan') {
    const envs: Env[] = [];
    let profile: string | undefined;
    let minAgeDays = 0;
    let json = false;
    let showAll = false;
    let quiet = false;
    const exclude: string[] = [];
    let root: string | undefined;
    const roots: string[] = [];

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--env') envs.push(rest[++i] as Env);
      else if (a === '--profile') profile = rest[++i];
      else if (a === '--min-age') minAgeDays = Number(rest[++i]);
      else if (a === '--exclude') exclude.push(rest[++i]!);
      else if (a === '--root') {
        const v = rest[++i];
        // Eksik deger sessizce tam taramaya donusmemeli: kullanici
        // proje taramasi beklerken tum diski taramis olurdu.
        if (!v || v.startsWith('-')) {
          throw new Error('--root bir dizin yolu ister. Ornek: residue scan --root C:\\proje');
        }
        roots.push(v);
        root = v;
      } else if (a === '--json') json = true;
      else if (a === '--all') showAll = true;
      else if (a === '--quiet') quiet = true;
    }

    const result = await runScan({
      envs,
      profile,
      minAgeDays,
      json,
      includeBytes: true,
      exclude,
      quiet,
      root,
      roots,
    });

    if (json) {
      console.log(JSON.stringify(scanJson(result), null, 2));
    } else {
      renderReport(result, showAll);
    }
    return;
  }

  if (cmd === 'clean') {
    const envs: Env[] = [];
    const only: string[] = [];
    const exclude: string[] = [];
    let profile: string | undefined;
    let purge = false;
    let yes = false;
    let dryRun = false;
    const allow: { history?: boolean; models?: boolean; rules?: boolean } = {};

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--env') envs.push(rest[++i] as Env);
      else if (a === '--profile') profile = rest[++i];
      else if (a === '--exclude') exclude.push(rest[++i]!);
      else if (a === '--only') only.push(rest[++i]!);
      else if (a === '--purge') purge = true;
      else if (a === '--yes' || a === '-y') yes = true;
      else if (a === '--dry-run') dryRun = true;
      else if (a === '--clear-history') allow.history = true;
      else if (a === '--nuke-models') allow.models = true;
      else if (a === '--reset-rules') allow.rules = true;
    }

    await runClean({ envs, profile, purge, yes, only, exclude, dryRun, allow });
    return;
  }

  if (cmd === 'ui') {
    // `ui` varsayilan olarak terminal (Ink) arayuzunu acar. `--web` ise
    // derlenmis tarayici kabugunu sunar (dist/web) ve varsayilan
    // tarayiciyi acar. Arayuz yalnizca ISTEK gonderir; karar motorda.
    const envs: Env[] = [];
    const exclude: string[] = [];
    let profile: string | undefined;
    let purge = false;
    let web = false;
    let noBrowser = false;
    let port = 0;

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--env') envs.push(rest[++i] as Env);
      else if (a === '--profile') profile = rest[++i];
      else if (a === '--exclude') exclude.push(rest[++i]!);
      else if (a === '--purge') purge = true;
      else if (a === '--web') web = true;
      else if (a === '--no-browser') noBrowser = true;
      else if (a === '--port') {
        const n = Number(rest[++i]);
        if (Number.isInteger(n) && n >= 0 && n <= 65535) port = n;
      }
    }

    if (web) {
      const { runApi } = await import('./web/server.ts');
      await runApi({
        envs,
        profile,
        exclude,
        port,
        serveUi: true,
        openBrowser: !noBrowser,
      });
      return;
    }

    const { runTui } = await import('./commands/tui.ts');
    await runTui({ envs, profile, exclude, mode: purge ? 'purge' : 'recycle' });
    return;
  }

  if (cmd === 'api') {
    // BASSSIZ HTTP/SSE API: arayuz yok. Gelecekteki arayuzun
    // dayanacagi sozlesme burada; bkz. docs/WEB-REBUILD-PLAN.md.
    const envs: Env[] = [];
    const exclude: string[] = [];
    let profile: string | undefined;
    let port = 0;

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--env') envs.push(rest[++i] as Env);
      else if (a === '--profile') profile = rest[++i];
      else if (a === '--exclude') exclude.push(rest[++i]!);
      else if (a === '--port') {
        const n = Number(rest[++i]);
        if (Number.isInteger(n) && n >= 0 && n <= 65535) port = n;
      }
    }

    const { runApi } = await import('./web/server.ts');
    await runApi({ envs, profile, exclude, port });
    return;
  }

  if (cmd === 'inventory') {
    await runInventory(rest);
    return;
  }

  if (cmd === 'repair') {
    await runRepair(rest);
    return;
  }

  if (cmd === 'quarantine') {
    await runQuarantine(rest);
    return;
  }

  if (cmd === 'status') {
    await runStatus(rest);
    return;
  }

  if (cmd === 'log') {
    if (rest.includes('--summary')) {
      await runLogSummary();
    } else {
      await runLog(rest);
    }
    return;
  }

  if (cmd === 'explain') {
    await runExplain(rest[0], { json: rest.includes('--json') });
    return;
  }

  if (cmd === 'doctor') {
    await runDoctor();
    return;
  }

  if (cmd === 'undo') {
    await runUndo(rest);
    return;
  }

  if (cmd === 'recover') {
    const { runRecover } = await import('./commands/recover.ts');
    await runRecover(rest);
    return;
  }

  if (cmd === 'vault') {
    const { runVault } = await import('./commands/vault.ts');
    await runVault(rest);
    return;
  }

  if (cmd === 'env') {
    const { runEnv } = await import('./commands/env.ts');
    await runEnv(rest);
    return;
  }

  if (cmd === 'project') {
    const { runProject } = await import('./commands/project.ts');
    await runProject(rest);
    return;
  }

  if (cmd === 'graph') {
    const { runGraph } = await import('./commands/graph.ts');
    await runGraph(rest);
    return;
  }

  if (cmd === 'schedule') {
    const { runSchedule } = await import('./commands/schedule.ts');
    await runSchedule(rest);
    return;
  }

  if (cmd === 'rules') {
    runRules();
    return;
  }

  console.log(`Komut henuz uygulanmadi: ${cmd}`);
  console.log(`Simdilik 'scan' ve 'clean' calisiyor. --help icin: residue --help`);
}

main().catch((err) => {
  console.error(`${C.red}Hata:${C.reset} ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});