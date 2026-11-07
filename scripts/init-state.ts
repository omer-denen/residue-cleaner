/**
 * `state.json` ISKELETI uretir (B18).
 *
 * Eski surum 10 gorevlik 2025 sablonunu kosulsuz yaziyordu; mevcut durum
 * dosyasinin uzerine gecip gercek gecmisi siliyordu. Yeni davranis:
 *
 *   - Dosya yoksa            -> iskelet yazilir (gorev listesi bos).
 *   - Dosya doluysa          -> YAZILMAZ, cikis kodu 1, `--force` onerilir.
 *   - `--force` verilirse    -> once `state.json.bak-<zaman>`, sonra iskelet.
 *
 * Kullanim:
 *   npm run init-state
 *   npm run init-state -- --force
 *   node --import tsx scripts/init-state.ts --dir <baska-dizin>
 */
import { resolve } from 'node:path';
import { StateScaffold } from '../src/core/state-scaffold.ts';
import { stateFile, writeStateSafely } from '../src/util/state.ts';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const dirAt = argv.indexOf('--dir');
const cwd = dirAt >= 0 && argv[dirAt + 1] ? resolve(argv[dirAt + 1]) : process.cwd();

const result = await writeStateSafely(StateScaffold.skeleton(), { cwd, force });

console.log(StateScaffold.describe(result.decision));
if (result.backup) console.log(`Yedek: ${result.backup}`);

if (result.written) {
  console.log(`Yazildi: ${stateFile(cwd)}`);
} else {
  process.exitCode = 1;
}
