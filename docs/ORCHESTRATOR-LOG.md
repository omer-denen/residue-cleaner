# Orkestratör Kaydı

> Her görev paketi buraya işlenir: doğrulama kanıtı, subagent sonucu,
> kapı sonuçları, commit. Protokol: `ORKESTRATOR.md`.

## 22.10.2026 — orkestratör çalışma alanı kuruldu

- Worktree: `C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator`
- Dal: `orkestrator` (detached HEAD'den açıldı), entegrasyon hedefi `main`
- `AGENTS.md`, `state.json`, `SESSION_LOG.md` elle kopyalandı (gitignore).
- Sıradaki iş: **T73 / P4** — C7–C11, E6, E7, E10, E11.
  Önce kodda doğrulama (handover §5), sonra görev paketleri.

## 22.10.2026 — baseline + işçi model

- `npm ci` worktree'de tamam (113 paket).
- Worktree'de `scratch/` yoktu (gitignore) → oluşturuldu; ilk `npm test`
  bu yüzden 35 fixture hatası verdi, düzeltmeden sonra **167/167**.
- `npm run typecheck` **temiz**.
- İşçi model (kullanıcı kararı): **GLM-5.3-Flash**, ayrı görünür
  PowerShell penceresi (`opencode run --standalone --auto`), subagent YOK.
- İlk görev paketi: `scratch/p4-dogrulama-gorevi.md` (SALT OKUNUR rapor).

### Orkestratör bağımsız doğrulama notları (rapor öncesi)

| Bulgu | Kendi kanıtım | Ön durum |
|---|---|---|
| C7 | `classifier.ts:1035-1042` yedek `readdir` try dışında; `logs\` öneki yedek dalda yanlış; `LOG_DIR_RE` `/^logs?$|^.*\.logs?$/i` `daemon.log` dosyasını eşliyor | DOĞRU |
| C8 | `classifier.ts:175` `Scripts` büyük harf, `:214` küçük harfe çevriliyor; `:226` `pyvenv.cfg` dizin dalında; `'venv'` fileKind üretilmiyor | DOĞRU |
| C9 | `analyze.ts:1283` `hasSdkMarker` tanımlı; çağrı yok | DOĞRU |
| C10 | `classifier.ts:501` `readdir` sırası; `:553` dedupe edilmemiş `fileKinds.length >= 4` | DOĞRU |
| C11 | `classifier.ts:1016` "Azure AI Foundry"; `.Muhasib` adı `classifier.ts:400,479`, `analyze.ts`, `merge.ts`, `types.ts` yorumlarında | DOĞRU |
| E6 | `analyze.ts:1005,1042` `MAX_DIRS` sessiz; `:914` sayısal `compareVersions` ön sürümü yok sayıyor; `:915` en yüksek sürüm "güncel" | KISMEN |
| E7 | `analyze.ts:1091-1093` ve `:1271` `startsWith`, dizin sınırı yok | DOĞRU |
| E10 | `editor-workspace` yalnız tablolarda; `:1151` ve `:1231` ajan alanı iki kez; `:1970` `GPU_STATE` global; `:61` `C:\Windows\System32` sabit | DOĞRU |
| E11 | `analyze.ts:713,1108,1606` kararlar `means` metnine bağlı | DOĞRU |

## 22.10.2026 — P4 doğrulama raporu (işçi: GLM-5.3-Flash)

- Rapor: `scratch/p4-dogrulama.md` (691 satır, salt okunur).
- Sonuç: **C7, C8, C9, C10, C11, E7, E10, E11 → DOĞRU**;
  **E6 → DOĞRU (E6b KISMEN)**. Orkestratörün bağımsız doğrulamasıyla uyumlu.
- Ek kanıt: `node-runtimes.ts` kendi `compareVersions`'ı ön sürümü yok sayıyor;
  `cli-references.ts:148` `.vscode/tasks.json` sabiti; `analyze.ts` yorumlarında
  örnek uygulama adları.
- **Kritik iki kapı:** E10d (`C:\Windows\System32` sabiti → yanlış
  `hasNvidia=false` → kullanılabilir CUDA runtime silme teklifi) ve
  E6c (en yüksek `app-<sürüm>` klasörünü körlemesine "güncel" sayma).
- Not: işçi raporunda yer yer Türkçe kelime bozulmaları var (model çıktısı);
  teknik içerik doğrulandı. Kod diff'leri bu yüzden ayrıca denetlenecek.

### Düzeltme sırası (orkestratör kararı)

C7 → C8 → C9 → C10 → E7 → E6 → **E10d (kritik)** → E10a/b → E10c → E11 → C11.
E10 tek package sığmayacak kadar farklı riskler içeriyor; üç ayrı commit.

### C7 — TAMAMLANDI

- Commit `1ef0998` · `src/core/classifier.ts` + `tests/classifier-robustness.test.ts`.
- `LOG_DIR_RE` yalnız dizin adları; `probeLogs` tek yol kurulumu, yedek dal
  kök girdilerden, çift okuma yok.
- Kapı: typecheck temiz · **174/174** (+7) · diff beyaz listede.
- Orkestratör notu: `probeLogs` artık her `probeDir`'de bir kez `logs\`
  readdir deniyor; maliyet aday kök başına tek çağrı, kabul edildi.

### C8 — TAMAMLANDI + C8b koruma paketi

- Commit `1f4b202` · `src/core/classifier.ts` + `tests/classifier-python-env.test.ts`.
- `pyvenv.cfg` dosya dalında `python-env`; `venv`/`.venv` dizini `venv`;
  `Scripts` yalnız destekleyici kanıtla işaret; küçük `scripts/` yanlış
  pozitif üretmiyor.
- Kapı: typecheck temiz · **182/182** (+8) · diff beyaz listede.
- **Açılan risk (rapor risk notu 1):** `analyze.ts:1167` 4b
  (`runtime-pool`) proje kontrolünden (4e) önce geldiği için
  `package.json` + `venv/` artık `project-workspace` değil `runtime-pool`
  olabilir. P1/E2 ile aynı sınıf sıra hatası → **C8b** paketi açıldı;
  `main`e merge C8b kapanmadan yapılmayacak.

### C8b — TAMAMLANDI

- Commit `6478828` · `src/core/analyze.ts` + `tests/project-runtime-order.test.ts`.
- 4b ikiye ayrıldı: **güçlü** havuz kanıtı (`envs/`, `runtimed/`) her
  durumda `runtime-pool`; **zayıf** kanıt (`python-env`, `venv`,
  `site-packages`) `projectManifest` varsa 4e'ye (proje) bırakır.
- Kapı: typecheck temiz · **189/189** (+7) · `agent-workspace` ve
  `report-only` regresyonları testli.

### C9 — TAMAMLANDI

- Commit `af229dc` · `classifier.ts` + `analyze.ts` + `tests/classifier-sdk.test.ts`.
- `sdkInstall` kombinasyon kanıtı: `sdk/` tek başına veya `shared/`+`tools/`;
  tek başına `tools/`, `host/`, `shared/` yetmez. Ölü `hasSdkMarker` silindi.
- Kapı: typecheck temiz · **198/198** (+9) · `os-user-data` hedefsiz regresyonu testli.

### C10 — TAMAMLANDI

- Commit `776946f` · `src/core/classifier.ts` + `tests/classifier-deep-probe.test.ts`.
- Çocuk dizinler isim sırasına göre deterministik örnekleniyor; erken çıkış
  benzersiz tür sayısına (`new Set(fileKinds).size >= 4`) bağlandı.
- Kapı: typecheck temiz · **202/202** (+4) · NuGet deposu regresyonu korundu.

### E7 — TAMAMLANDI

- Commit `f6219cd` · `src/core/analyze.ts` + `tests/path-boundary.test.ts`.
- `isPathInside` + `normalizeBoundary` (eşitlik veya `parent + '\\'`, `\\?\`,
  eğik çizgi, `..`, küçük harf); `rootScope` ve `isTempPath` buna bağlandı.
- Kapı: typecheck temiz · **210/210** (+8) · `Temp2`, `Local2`, `UserProfile2`
  yanlış eşleşmiyor; gerçek `%TEMP%`/`%LOCALAPPDATA%` davranışı korunuyor.

### E6 — TAMAMLANDI

- Commit `0bb2aac` · `analyze.ts` + `node-runtimes.ts` + `tests/version-boundaries.test.ts`.
- `findDirsNamed`/`findDirsContaining` → `{dirs, truncated}`; sınır aşılırsa
  alt parçalar `report-only` + gerekçe notu (silme hedefi yok).
- Sürüm karşılaştırma tek kaynak `semver.ts`; `app-1.2.4-beta < app-1.2.4`;
  eşitlikte klasör adı deterministik.
- "Güncel sürüm" ek kanıtı: `Update.exe` VersionInfo (süreç açılmaz). Kanıt
  yoksa eski sürümler `report-only`; `buildDeleteTargets` yalnız
  `recommend|ask` parçaları hedefler.
- Kapı: typecheck temiz · **221/221** (+11).

### E10d — TAMAMLANDI

- Commit `d5587ee` · `src/core/analyze.ts` + `tests/gpu-detect.test.ts`.
- `systemRootPath()`: `%SystemRoot%` → `%SystemDrive%\Windows` → `C:\Windows`;
  adaylar `System32\nvcuda.dll` + ek kanıt `SysWOW64\nvcuda.dll`. Sabit
  `C:\Windows` artık birincil değil; `longPath` korunuyor.
- Erişim hatası (`EACCES`/`EPERM`) notta "bilinmiyor" olarak ayrıldı.
- Kapı: typecheck temiz · **226/226** (+5).
- **Açık risk:** erişim hatasında `hasNvidia:false` dönüyor; motor üçlü
  durumu bilmiyor. E10c'de `gpu: null` (bilinmiyor) ayrımı yapılacak.

## 23.10.2026 — işçi model değişikliği (kullanıcı kararı)

- Yeni işçi modeli: **`opencode/glm-5.3-flash-free`** (GLM-5.3-Flash Free).
- E10a/b ilk denemesi `opencode-go/glm-5.3-flash` ile başlatıldı; kullanıcı
  kararı üzerine süreç durduruldu, yarım dosya değişiklikleri geri alındı
  (`git checkout -- src`), görev temiz ağaçtan yeniden çalıştırıldı.
- Log: `scratch/logs/e10ab-glm53flash.log` (eski), `scratch/logs/e10ab.log` (yeni).

### E10a/b — TAMAMLANDI

- Commit `e95c50b` · `src/core/analyze.ts`, `types.ts`, `categories.ts`,
  `evidence-text.ts`, `merge.ts` + `tests/archetype-hygiene.test.ts` (**8 test**).
- `editor-workspace` archetype'ı tip birliğinden ve 7 tablodan tamamen
  kaldırıldı; `src/` altında eşleşme yok.
- Adım 7'deki `skill-store`/`skill-lock` tekrarı ve yalnız-log dalı
  (`notebook|gunlendirme gunlugu|arka plan servisi`) kaldırıldı; adım 16
  yalnız `sessions/skills/memories/agents` marker'larıyla `agent-workspace`
  üretiyor. Adım numaraları tek sıraya (1..19) döküldü.
- **Orkestratör denetimi:** diff yalnız beyaz listede; mevcut test
  dosyaları değişmedi; `agent-workspace` hedefsizliği ve `report-only`
  korunuyor; uygulama adı eklenmedi.
- Kapı: typecheck temiz · **234/234** (+8) · `git diff --check` temiz.
- **Davranış notu (bilinçli):** yalnız log satırı taşıyan klasör artık
  `agent-workspace` değil `unknown`; iki karar da silme hedefi üretmez.

### E10c — TAMAMLANDI

- Commit `2c40f21` · `analyze.ts` + `scan.ts` + `tui.ts` + `doctor.ts` +
  `tests/gpu-state-injection.test.ts` (**8 test**).
- `GPU_STATE`/`setGpuState` kaldırıldı; GPU kanıtı `ClassifyOptions.gpu`
  ile parametre. `detectGpu()` üçlü durum: kanıt / kesin yok (ENOENT) /
  `null` (erişim engellendi = bilinmiyor). `null` iken `gpuAbsent=false`.
- **Orkestratör denetimi:** işçi beyaz listeyi 3 dosyada aştı
  (`doctor.ts`, `gpu-detect.test.ts`, `version-boundaries.test.ts`) —
  `detectGpu` imza değişikliğinin zorunlu mekanik sonucu; assertion
  silinmedi/zayıflatılmadı, yalnız null daraltması ve `setGpuState`
  kurulumu kaldırıldı. Kabul edildi.
- Kapı: typecheck temiz · **242/242** (+8) · global sızıntı testi
  (ardışık `classifyPath`) geçiyor.

### T54 — TAMAMLANDI (kullanıcı kararı, 23.10.2026)

- Commit `893331c` · `data-dir.ts`, `discover.ts`, `guard.ts`,
  `tests/discovery-guards.test.ts`, `tests/safety.test.ts`,
  `tests/legacy-name-removed.test.ts` (**4 test**), README TR/EN,
  `ENGINE-ROADMAP`, `T44-PLAN`, analiz belgesi.
- Eski ad (`clicleaner`) **kod + test + güncel belgelerden** tamamen
  kaldırıldı: `LEGACY_DATA_DIR_NAME`, `legacyDataDir()`, `ownDataDirs()`
  eski yolları, `guard.ts` eski ad koruması yok. Tek veri dizini
  `%LOCALAPPDATA%\residue` (ve `~/.residue`).
- **Disk doğrulaması:** `%LOCALAPPDATA%\clicleaner` YOK; eski repo
  klasörleri YOK → silinecek veri yok. npm `clicleaner@1.0.0` registry'de
  kalır (geri çekilemez; deprecate durumunda).
- **Kapsam (kullanıcı seçimi):** tarihsel `docs/HANDOVER-*` ve `CHANGELOG`
  kayıtları arşiv olarak korunur.
- **Güvenlik notu:** eski dizin artık "kendi veri" sayılmıyor; bu makinede
  dizin olmadığı için veri riski yok. Başka bir makinede eski kasa varsa
  taranmadan önce elle taşınmalı.
- Kapı: typecheck temiz · **246/246** (+4) · `src/` içinde eski ad 0 eşleşme.

### E11 — TAMAMLANDI

- Commit `06f8be2` · `classifier.ts` + `analyze.ts` + `types.ts` +
  `tests/log-signal-kind.test.ts` (**11 test**).
- `LogSignal.kind?: LogSignalKind` eklendi (opsiyonel: eski kanıtlar
  bozulmasın). `LOG_MARKERS` her girişte `kind` taşıyor; `means` artık
  yalnız gösterim metni.
- Kararlar `kind`e bağlandı: `logGpuVerdict` (`gpu-provider`),
  `detectArchetype` model/npm/nuget dalları, `decideBase.npmManaged`.
  `signalKind()` kind yoksa kanonik `means`ten eşler (geriye dönük uyum).
  `dedupeLogSignals` anahtarı `kind ?? means`.
- **Bilinçli sınır:** `cpuLine` ham log satırından okunmaya devam ediyor
  (eski kanıt/testler means içinde "Device: CPU" taşıyor); E11 kapsamı
  yalnız `means` bağımlılığı. `merge.ts` dedupe beyaz liste dışında
  bırakıldı; nihai kanıt `analyze.ts` içinde kind ile tekilleşiyor.
- Kapı: typecheck temiz · **257/257** (+11) · mevcut GPU/log testleri yeşil.

### C11 — TAMAMLANDI · P4 KAPANDI

- Commit `3efccbc` · `classifier.ts`, `analyze.ts`, `merge.ts`, `types.ts`,
  `cli-references.ts`, `cli-remove.ts`, `explain.ts`,
  `tests/log-signal-kind.test.ts`, `tests/source-hygiene.test.ts` (**2 test**).
- Yorumlar ve görünen metinler nötrleştirildi (`ornek-uygulama`, `ornek CLI`,
  `bulut model katalogu`); `.vscode/tasks.json` sabiti yerine herhangi bir
  alt dizindeki `tasks.json` aranıyor (referans kontrolü gevşemedi; üst
  sınırlar `MAX_DIRS=40`, `MAX_CANDIDATES=120` aynı).
- Yeni hijyen testi `src/**/*.ts` içinde yasaklı adları `dosya:satır` ile
  raporluyor; `MuhasibPro`, `opencode`, `claude`, `vscode`, `clicleaner`
  dahil 11 ad yasaklı, `Residue` serbest.
- **Orkestratör bağımsız doğrulama:** `src/` içinde yasaklı ad 0 eşleşme;
  `cli-references` yalnız kapsamı genişletti (aynı derinlik + alt dizin),
  hiçbir güvenlik kapısı değişmedi.
- Kapı: typecheck temiz · **259/259** (+2) · `git diff --check` temiz.
- **P4 (T73) KAPANDI:** C7, C8, C8b, C9, C10, E6, E7, E10a/b, E10c, E10d,
  E11, C11 tamam. Test 226 → **259**.
- **Sıradaki:** T69 (kanıt hijyeni) → T30 → T37 → web (T74, 3 profil).










