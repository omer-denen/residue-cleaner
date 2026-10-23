import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedStats, findStateDirs } from '../src/core/cli-inventory.ts';

// T69/F2: durum kaniti hijyeni. Log/arka plan yazimi kullanim kaniti
// degildir (Kural 21); %LOCALAPPDATA%\Programs kurulum dizinidir (E4).

// Fixture koku %TEMP% DEGIL; scratch/ altindadir ve sonda silinir.
let root = '';

const OLD_TIME = Date.parse('2020-01-02T03:04:05Z'); // eski durum yazimi
const MID_TIME = Date.parse('2022-06-07T08:09:10Z'); // eski ama daha yeni durum yazimi
const NEW_TIME = Date.parse('2026-10-23T00:00:00Z'); // bugun (log/arka plan yazimi)

before(async () => {
  root = join(process.cwd(), 'scratch', 'state-evidence-fixture');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Tolerans: utimes ms cozunurlugunde; 50 ms icerisinde esit sayilir. */
function assertNear(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 50,
    `${label}: beklenen ${expected}, gelen ${actual}`,
  );
}

/** K21: fs.utimes sayi ms ile Windows'ta EINVAL verir; Date nesnesi kullan. */
async function setTimes(p: string, ms: number): Promise<void> {
  await utimes(p, new Date(ms), new Date(ms));
}

test('findStateDirs: %LOCALAPPDATA%\\Programs\\<ad> kurulum dizini durum adayı değildir', async () => {
  const home = join(root, 'home');
  const appData = join(root, 'roaming');
  const local = join(root, 'local');
  // Hem kurulum hem de gerçek durum klasörü var: yalnızca durum klasörü dönmeli.
  await mkdir(join(local, 'Programs', 'ornek-arac'), { recursive: true });
  await mkdir(join(appData, 'ornek-arac'), { recursive: true });

  const res = await findStateDirs('ornek-arac', 'ornek-arac', {
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: local,
  });

  assert.ok(
    res.dirs.includes(join(appData, 'ornek-arac')),
    'APPDATA durum klasörü aday kalmalı',
  );
  for (const d of res.dirs) {
    assert.ok(!d.includes('Programs'), `kurulum dizini dönmemeli: ${d}`);
  }
});

test('boundedStats: yeni log zamanı kanıt girmez; eski config zamanı döner', async () => {
  const st = join(root, 'log-durumu');
  await mkdir(join(st, 'logs'), { recursive: true });
  await writeFile(join(st, 'config.json'), '{}');
  await writeFile(join(st, 'logs', 'app.log'), 'servis yazisi');
  await setTimes(join(st, 'config.json'), OLD_TIME);
  await setTimes(join(st, 'logs', 'app.log'), NEW_TIME);
  await setTimes(join(st, 'logs'), NEW_TIME); // klasörün kendi mtime'ı da yeni

  const res = await boundedStats(st);
  assertNear(res.lastMtime, OLD_TIME, 'lastMtime eski config zamanı olmalı');
});

test('boundedStats: state.jsonl ve session.tmp yeni olsa bile sonuca girmez', async () => {
  const st = join(root, 'jsonl-durumu');
  await mkdir(st, { recursive: true });
  await writeFile(join(st, 'config.json'), '{}');
  await writeFile(join(st, 'state.jsonl'), '{"x":1}\n');
  await writeFile(join(st, 'session.tmp'), 'gecici');
  await setTimes(join(st, 'config.json'), OLD_TIME);
  await setTimes(join(st, 'state.jsonl'), NEW_TIME);
  await setTimes(join(st, 'session.tmp'), NEW_TIME);

  const res = await boundedStats(st);
  assertNear(res.lastMtime, OLD_TIME, 'jsonl/tmp yazimlari kanit sayilmamali');
});

test('boundedStats: data.db ve settings.json durum kanıtı olarak sayılmaya devam eder', async () => {
  const st = join(root, 'db-durumu');
  await mkdir(join(st, 'logs'), { recursive: true });
  await writeFile(join(st, 'config.json'), '{}');
  await writeFile(join(st, 'settings.json'), '{}');
  await writeFile(join(st, 'data.db'), 'sqlite');
  await writeFile(join(st, 'logs', 'service.log'), 'log');
  await setTimes(join(st, 'config.json'), OLD_TIME);
  await setTimes(join(st, 'settings.json'), Date.parse('2021-03-04T05:06:07Z'));
  await setTimes(join(st, 'data.db'), MID_TIME);
  await setTimes(join(st, 'logs', 'service.log'), NEW_TIME);
  await setTimes(join(st, 'logs'), NEW_TIME);

  const res = await boundedStats(st);
  assertNear(res.lastMtime, MID_TIME, 'en yeni durum dosyasi (data.db) donmeli');
});

test('boundedStats: logs klasörünün kendi mtime\'ı yeni olsa bile sonuca girmez', async () => {
  const st = join(root, 'logs-dir-durumu');
  await mkdir(join(st, 'logs'), { recursive: true });
  await writeFile(join(st, 'logs', 'eski.log'), 'eski yazı');
  await writeFile(join(st, 'config.json'), '{}');
  await setTimes(join(st, 'config.json'), OLD_TIME);
  await setTimes(join(st, 'logs', 'eski.log'), OLD_TIME);
  await setTimes(join(st, 'logs'), NEW_TIME); // klasör bugün "dokunulmuş"

  const res = await boundedStats(st);
  assertNear(res.lastMtime, OLD_TIME, 'log klasörünün mtime\'ı sayılmamalı');
});

test('boundedStats: node_modules ve dist ağaçlarına girilmez', async () => {
  const st = join(root, 'tree-durumu');
  await mkdir(join(st, 'node_modules', 'paket'), { recursive: true });
  await mkdir(join(st, 'dist'), { recursive: true });
  await writeFile(join(st, 'node_modules', 'paket', 'index.js'), 'x');
  await writeFile(join(st, 'dist', 'cikti.js'), 'x');
  await writeFile(join(st, 'config.json'), '{}');
  await setTimes(join(st, 'config.json'), OLD_TIME);
  await setTimes(join(st, 'node_modules'), OLD_TIME);
  await setTimes(join(st, 'node_modules', 'paket'), NEW_TIME);
  await setTimes(join(st, 'node_modules', 'paket', 'index.js'), NEW_TIME);
  await setTimes(join(st, 'dist'), OLD_TIME);
  await setTimes(join(st, 'dist', 'cikti.js'), NEW_TIME);

  const res = await boundedStats(st);
  assertNear(res.lastMtime, OLD_TIME, 'derin yeni dosyalar sayılmamalı');
});
