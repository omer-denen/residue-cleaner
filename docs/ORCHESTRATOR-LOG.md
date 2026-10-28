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

## 23.10.2026 — T69 başladı (kanıt hijyeni)

- İşçi model notu: `opencode/glm-5.3-flash-free` kotası doldu
  (`Free usage limit reached`); kullanıcı onayıyla **`opencode-go/glm-5.3-flash`**
  kanalına dönüldü. `ORKESTRATOR.md` güncellendi (`d26371c`).

### F1 — TAMAMLANDI

- Commit `8d9610a` · `cli-inventory.ts` + `tests/inventory-atime.test.ts`
  (**5 test**).
- Ortak `withPreservedFileTimes` + `readExeInfoPreservingTimes` eklendi;
  `scanStandaloneShims`, `annotateHealth` ve `readShimTarget` aynı yardımcıyı
  kullanıyor. Okuma öncesi atime/mtime saklanıp `finally` ile geri yazılıyor.
- **Yeni bulgu (K21):** Bu ortamda (win32 + Node 24) `fs.utimes` **sayı ms**
  argümanıyla `EINVAL` veriyor; eski `readShimTarget` geri yazımı bu yüzden
  sessizce başarısızdı. Yardımcı `Date` nesnesi kullanıyor; gerçek geri
  yazım artık çalışıyor.
- Kapı: typecheck temiz · **264/264** (+5). Duyarlılık provası: restore
  olmadan `readExeInfo` atime'i bugüne çekiyor; test regresyonu yakalıyor.
- **Sıradaki:** F2 (durum kanıtı: log/Programs) → F3 (karar) → F4 (geçmiş)
  → F5 (görünürlük).

### F2 — TAMAMLANDI

- Commit `a783f3e` · `cli-inventory.ts` + `tests/inventory-state-evidence.test.ts`
  (**6 test**).
- `findStateDirs` adaylarından `%LOCALAPPDATA%\Programs\<ad>` çıkarıldı
  (kurulum dizini; E4). Env enjeksiyonu test için opsiyonel parametre.
- `boundedStats` gürültü süzgeci: `*.log|*.jsonl|*.tmp|*.pid` sayılmıyor;
  `logs?/caches?/tmp/temp` klasörleri ne sayılıyor ne geziliyor;
  `node_modules/.git/dist` içine girilmiyor (kendi mtime'ı sayılıyor).
- Kapı: typecheck temiz · **270/270** (+6).
- **Sıradaki:** F3 (kullanım kararı: atime tek başına `recent` olmasın,
  kurulum-atime ayrımı, toplu atime filtresi, geçmiş tek başına `recent`
  üretmesin) → F4 → F5.

### F3 — TAMAMLANDI

- Commit sonrası: `cli-inventory.ts` + `tests/inventory-usage-verdict.test.ts`
  (**12 test**).
- `usageVerdict` yeniden yazıldı: atime yalnız **doğrulayıcı sinyalle**
  (durum klasörü veya geçmiş) `recent` üretir; tek başına atime → `unknown`
  (low). Kurulum-atime ≤2 sn ise atime yok sayılır. Geçmiş tek başına →
  `unknown` (medium, "zaman bilinmiyor"). `historyRecent` kaldırıldı.
- `findAtimeBursts` + `applyAtimeBurstFilter`: 5 sn içinde ≥3 araç atime'ı
  → yalnız-atime `recent` kararları `unknown` (low); durum klasörü güncel
  olanlar korunur.
- Kapı: typecheck temiz · **282/282** (+12).

### F4 — TAMAMLANDI

- Commit `ec9478d` · `cli-inventory.ts` + `tests/inventory-history.test.ts`
  (**18 test**).
- `findHistoryMentions(history, command, packageName?)`: paket
  çalıştırıcıları (`npx/pnpx/bunx/uvx/pipx`, `pnpm/yarn dlx|exec`,
  `npm exec`, `pnpm/yarn/bun <ad>`, `dotnet tool run <ad>`) tanınıyor;
  kurulum satırları (`npm install|add|remove` vb.) kullanım sayılmıyor.
- Orkestratör denetiminde yanlış pozitif bulundu: çalıştırıcının **argümanı**
  paket sanılıyordu (`npx bir-arac ornek`). F4b ile yalnız **ilk** bayraksız
  belirteç değerlendiriliyor; `--from/--with` değer bayrakları eklendi.
- Kapı: typecheck temiz · **300/300** (+18).

### F5 — AÇIK (web onayı bekliyor · kullanıcı kararı 23.10.2026)

- Mevcut Tools ekranı zaten **durum + güven + kanıt listesi**ni gösteriyor
  (`Tools.tsx`: `cli-status-*`, `confidence.*`, `detail.evidence`).
- F3 ile atime tek başına `recent` üretmediği için "Yakında" yalnız
  doğrulanmış sinyalde çıkıyor; aksi halde `Bilinmiyor`.
- Eksik kalan **görsel "kanıt türü" rozetleri** (state/history/atime/
  install ayrımı) web tarafında bir değişiklik gerektirir.
- **Kullanıcı kararı:** web arayüzüne (T74) **onay alınmadan geçilmez**.
  Bu yüzden F5 kapatılmadı, açık bırakıldı; web onayı verilince T74 ile
  birlikte ele alınacak.
- **T69 durumu:** F1–F4 tamam; **F5 açık**. T30/T37 (web dışı) devam eder.

## 23.10.2026 — T30 tamamlandı (global AI model artıkları)

- Commit `58fa537` · `classifier.ts`, `analyze.ts`, `types.ts` +
  `tests/global-ai-artifacts.test.ts` (**10 test**).
- `FileKind` → `model-weight`; `.gguf` / `.safetensors` dosya türü.
- Kök seviyede **kombinasyon kanıtı**: model ağırlığı (`.onnx`, `.gguf`,
  `.safetensors`, `pytorch_model.bin`, `model.bin`) **+** manifest
  (`config.json`, `tokenizer.json`, `tokenizer_config.json`,
  `genai_config.json`) → `model-store`. Tek başına ağırlık/manifest yetmez;
  genel `data.bin` sayılmaz (kural 13).
- `model-store` varsayılan **0 hedef**; yalnız `allow.models`
  (`--nuke-models`) ile hedef, `high` risk + `ask` (yazılı onay).
- Log klasörleri T30 kapsamı dışında; yalnız `logs/app.log` → `unknown`.
- **Orkestratör denetimi:** diff beyaz listede; `model-weight` kind'i
  tek başına karar üretmiyor, yalnız `probe.modelStore` kombinasyonu
  okunuyor; proje/ajan koruması model kanıtından önce geliyor.
- Kapı: typecheck temiz · **310/310** (+10).
- **Web kapısı yürürlükte:** T74 / web arayüzü kullanıcı onayı olmadan
  başlamaz. Sıradaki: **T37** (yarım güncelleme artıkları) ve **F5**
  (web onayı bekliyor).

## 23.10.2026 — T74 profil modeli netleştirildi (kod değişikliği yok)

- **Kullanıcı sorusu:** "3 kullanıcı profili" hız / derin analiz veya zorluk
  seviyesi olarak mı modellendi?
- **Kodda doğrulama (salt okunur):**
  - `src/core/discover.ts` → `BUILTIN_PROFILES`: `lean`, `audit`, `full`.
    Bunlar **tarama kapsamı**dır; `audit.readOnly` bir güvenlik modudur,
    hız/derinlik/zorluk değildir.
  - `web/src/screens/Disk.tsx` → `profile` alanı tarama kapsamı seçicisidir;
    i18n etiketi "Ortam profili".
  - `web/src/screens/Graph.tsx` → `protect` / `experiment` **bakış profili**;
    yalnız bölüm sırasını değiştirir.
  - Kullanıcı personası için henüz kod yok (T74 planned).
  - **"Hızlı temizlik" / "derin temizlik" modu yok.** `docs/T44-PLAN.md`
    §1'deki "ayda bir derin temizlik" yalnız kullanım sıklığı ifadesidir.
- **Karar:** standart kullanım korunur. Üç kullanıcı profili bir mod veya
  zorluk değil, **sunum + varsayılan görünüm** eksenidir.
  Kanonik tanım: `docs/PROFILE-MODEL.md` (üç eksen, izinli/yasak listeler,
  T74 kabul testleri).
- `docs/T44-PLAN.md` §1 tarihsel iki-profil taslağı olarak işaretlendi.
- Baseline: typecheck temiz · **310/310**.
- **Sıradaki:** W0-a `docs/READINESS-MATRIX.md` + E2E kataloğu; sonra
  W0-b (F5 + parity + web E2E) ve W1 (T74).

### W0-a — TAMAMLANDI (readiness matrisi + E2E kataloğu)

- Commit `989a704` · `docs/READINESS-MATRIX.md` (yeni, 268 satır).
- Seviye ölçeği L0–L5 (kanıtsız davranış "hazır" sayılmaz).
- Ağırlıklar: işlevsel 25 · güvenlik değişmezleri 25 · hata 15 · HTTP
  güvenliği 15 · gözlemlenebilirlik 10 · performans 5 · yük 5.
- **Mevcut skor 68.00**; alpha eşiği 70 → **açık** (fark, perf/load 0
  puanından). Devir belgesindeki "alpha" ifadesi sayısal kapıyla uyumsuz
  bulundu; matriste düzeltildi.
- E2E kataloğu **90 senaryo**: CLI 6, SAFE 12, ERR 8, SEC 8, API 10,
  PARITY 5, SCHED 5, ENV 4, PERF 3, LOAD 4, WEB 18, PROFILE 7.
- Öne çıkan açıklar: Git tracked + junction koruması `npm test` dışında;
  CLI E2E ve CLI↔API parity yok; `delete`/`vault` hata enjeksiyonu yok;
  perf/load eşiği yok; web tarayıcı E2E yok.
- Kapı: yalnız belge; kod değişmedi · typecheck temiz · **310/310**.
- **Sıradaki:** W0-b — önce CLI E2E + parity + perf (alpha), sonra F5 +
  web E2E + a11y; ardından W1 (T74 profilleri).

## 23.10.2026 — web arayüzü yönü + plan paneli API (T74)

**Kullanıcı kararı:** aynı web arayüzü geliştirilecek; sağ panel dinamik
olacak; plana alınan dosya/klasörler panelde görünecek ve çıkarılabilecek;
liste satırında `Planda` yazacak. "İnternetten karşılığını araştır, güzel
bir arayüz çıkar" — tasarım serbestliği verildi.

- **Arayüz denetimi (headless Edge/CDP, kullanıcı onayı):** 1440×900'de
  rail 208 px, liste 886 px, panel 320 px; Disk'te liste yalnız ~420 px
  yükseklikte ve sayfa ile liste iç içe kayıyor; `bilinmiyor` değeri kartta
  taşıyor. Ekran görüntüleri `scratch/cdp/`.
- **ego-browser engeli:** oturumun tamamı (Explorer dahil) **High
  integrity**. `ego-browser` medium-integrity relay ister; sınırlı görev de
  High çalıştı. Çözüm: sonraki oturumu **yönetici olmayan** terminalde açmak.
  Bu oturumda görsel doğrulama headless Edge/CDP ile yapıldı.
- **Tasarım:** `docs/UI-REDESIGN-2026-10-23.md` — geniş liste, yalnız liste
  kaydırma, 300–560 px yeniden boyutlandırılabilir panel, gruplu plan,
  `Planda` rozeti, "Plana ekle".
- **Motor/API (işçi + orkestratör denetimi):**
  - `PlanPanelView` + `planTargetId` (`src/core/plan-panel.ts`); gruplama,
    sıralama, sayım motorda.
  - `DeleteService.removeFromPlan` + `POST /api/plan/remove`; istemci yol
    göndermez, yalnız `key` / `targetId`.
  - İşçi testleri `api.test.ts` içine koyduğu için tarama önbelleği sonraki
    disk testini kirletiyordu. Orkestratör plan testlerini ayrı dosyaya
    taşıdı (`tests/api-plan-panel.test.ts`); **319/319**.
- Commit `061c1fe` (tasarım), `2e6d506` (motor/API); `main`e fast-forward.
- **Web UI uygulaması başladı ve W1 tamamlandı (23.10.2026, bu oturum).**
  Ayrıntı: `docs/HANDOVER-2026-10-23e.md`.

## 23.10.2026 — W1-a: panel + Disk listesi (T74)

- Görev paketi `scratch/gorev-w1a.md`; işçi `opencode-go/glm-5.3-flash`
  (ayrı PowerShell penceresi, `--standalone --auto`); log `scratch/logs/w1a.log`.
- Beyaz liste: `web/src/App.tsx`, `screens/Disk.tsx`, `i18n.ts`,
  `styles.css`, `components/icons.tsx`.
- **Sonuç:** panel 300–560 px (varsayılan 380, `residue.panelWidth`), 8 px
  ayırıcı + klavye + çift tık; `main-fill` yalnız Disk → yalnız liste
  kaydırılır; kompakt toolbar + kapalı gelişmiş filtreler; `Planda` rozeti;
  "Plana ekle" mevcut `panel.keys` ile birleşir, sayfa değişmez.
- **Orkestratör denetimi:** üç mekanik düzeltme — `.filters-advanced[hidden]`
  (UA `hidden`'ı `display:flex` eziyordu), `.page-actions` hizası,
  `onPlanStale` → `setPlan(null)` + `setPlanned(null)`.
- Commit `4cc1ed5` · 5 dosya +449/−149 · typecheck temiz · **319/319** ·
  build **125.67 kB gzip**.
- **Görsel doğrulama yapılmadı** (ego-browser High integrity engeli).

## 23.10.2026 — W1-b: sağ panel plan grupları (T74)

- Görev paketi `scratch/gorev-w1b.md`; aynı işçi/log `scratch/logs/w1b.log`.
- Beyaz liste: `web/src/api.ts`, `App.tsx`, `components/PlannedModule.tsx`,
  `icons.tsx`, `i18n.ts`, `styles.css`.
- **Sonuç:** `api.removeFromPlan` → `POST /api/plan/remove` (istemci yol
  göndermez); panel özeti (toplam bayt, küme/hedef sayısı, `mm:ss` TTL —
  yalnız gösterim), gruplu hedefler, küme/tek hedef çıkarma, boş durum,
  `role="alert"` hata, sticky özet/alt eylem. App plan kimliği/TTL'i korur;
  404/410'da `plan` + `planned` temizlenir.
- **Orkestratör denetimi:** plan grubu risk noktası `aria-label` kazandı
  (`role="img"`); başka kapsam dışı değişiklik yok.
- Commit `f194eb2` · 6 dosya +430/−91 · typecheck temiz · **319/319** ·
  build **126.44 kB gzip** · `npm run smoke` **35/35**.
- **Görsel/DOM doğrulaması AÇIK:** ego-browser bu oturumda çalışmadı
  (`High integrity` → medium relay yok). Kullanıcı kararı: bilgisayarı
  yeniden başlatıp OpenCode'u **yönetici olmayan** normal terminalde açmak.
  Ayrıntı ve kabul listesi: `docs/HANDOVER-2026-10-23e.md` §3.
- **Sıradaki:** W1 görsel doğrulaması → F5 → W0-b (CLI E2E/parity/perf) →
  T74 W2 (persona) → T37.











## 23.10.2026 — W1 kabulü + Plan Durumu (W2) — orkestratör

- **W1 görsel kabulü (ego-browser, 1440×900):** 8/8 madde geçti. Ölçümler:
  .panel-resizer 300–560 / varsayılan 380 / aria-valuenow, ArrowLeft +16,
  Home/End, çift tık, sürükleme sınır kırpması, localStorage kalıcılığı,
  ≤1180 px gizleme; Disk'te sayfa kaymıyor (scrollHeight == clientHeight),
  .cluster-scroll 464/4320 kayıyor; "Planda" rozeti + accent; plan birleşmesi
  6→7 küme / 5.5→15.4 GB; TTL sayacı; tek hedef ve küme çıkarma (planId sabit);
  boş durum; Plan ekranı senkronu. Konsol hatası yok.
  Kayıt: scratch/w1-kabul-sonuc.md.
- **W2-a** (6c1b2c2): addToPlan — planId/createdAt/TTL korunur, idempotent,
  buildPlan kapısı atlanmaz; POST /api/plan/add; POST /api/plan/remove keys[].
  **+8 test → 327/327**.
- **W2-c** (55c80ad): PlanResponse.name + renamePlan + PATCH /api/plan/:id;
  ad trim 1..60, kimlik/TTL korunur. **+5 → 332/332**.
- **W2-b** (36534dc): Plan Durumu paneli; checkbox = plana ekleme (tek yön),
  satırda **Plana Eklendi** + accent + kilit + **Plandan çıkar**; üstte
  Planı uygula / Kaydet / Yeni plan / Tümünü boşalt; gruplu içerik;
  **geçerlilik** satırı (kalan mm:ss · HH:mm'e kadar + ipucu); süre dolunca
  role=alert uyarısı; **Mevcut plan var (N öğe · X GB)** onayı; Araçlar
  bölümü; Plan ekranında ad + geçerlilik. Plan **boş başlar** (otomatik
  varsayılan seçimi kaldırıldı). Build **128.05 kB gzip**, smoke **35/35**.
- **Orkestratör düzeltmeleri (W2-b):** Araçlar bölümü boş planda da görünür;
  geçersiz plan uyarısı her ekranda (sekme açıkken panelde, değilse main
  içinde — çift uyarı yok); .cluster-row ızgarası esnek minmax kolonlara
  çevrildi + scrollbar-gutter: stable → son kolondaki **Plandan çıkar**
  düğmesi artık tıklanabilir (önce kaydırma çubuğu engelliyordu;
  elementFromPoint = .cluster-scroll).
- **Model kararı** (d780834, docs/PLAN-STATUS-MODEL.md): kalıcı çoklu plan
  yapılmadı; **tek aktif plan** (10 dk TTL) + değiştirme onayı; "bir öğe iki
  planda olamaz" yapısal olarak sağlanır; plan **kalıcı değil**; yürütme
  planı her zaman güncel taramadan buildPlan+guard ile kurulur.
- **Kullanıcı geri bildirimi (aynı oturum):** "Kaydet" kaldırılıyor (10 dk
  TTL'li planda saklama anlamsız); **Bağlam sekmesi** Kanıtlar içine bölüm
  olarak taşınıyor (öğe kanıtı ≠ uygulama bağlamı ayrımı korunarak);
  **Bağımlılıklar** ayrı sekme değil, Kanıtlar içinde "Bağımlılıkları göster"
  düğmesiyle seçili öğenin ayrıntısı olarak gösterilecek (eşleştirme motorda).
- **Devam eden:** W2-d (web: Kaydet kaldır + Bağlam'ı Kanıtlar'a taşı),
  W2-e1 (src: GET /api/dependencies + saf eşleştirici), W2-e2 (web: düğme +
  bölüm).
- **Gerçek silme/plan çalıştırma YAPILMADI.** Kasa değişmedi.

## 24.10.2026 — Doğrulama: "eski tarama" hatası ve plan ömrü

**Kullanıcı bulgusu:** "eski tarama listeleniyor; nuget boyutu değişmiş
olabilir; bu bir hata" + "plan uygulanmazsa her açılışta silinsin,
uygulanırsa 10 dk".

**Ölçülen kanıt (gerçek disk):**

- last-scan.json finishedAt **2026-10-21T11:54:43Z** (2 gün).
- 37 hedeften **6 tanesi diskte YOK** → **5.47 GB** hayalet alan
  (rattler 2.58 / uv 2.36 GB / 3 updater / FreeLLMAPI). Klasörler kasaya
  taşınmış (vault/b-17926917…), liste hâlâ boyut gösteriyor.
- .nuget gerçek **9.97 GB** = önbellekteki 10.0 GB → sorun "yanlış sayı"
  değil, **doğrulama yok**.
- dirty.json var (22.10) → rozet uyarıyor ama liste düzelmiyor;
  markScanDirty yalnız /api/execute sonrası yazılıyor.
- GET /api/disk doğrudan ctx.scan.last() döndürüyor; scan-cache yalnız
  24 saatlik yaş süzgeci uyguluyor (scan-cache.ts:15).
- App açılışta api.planned() çağırıyor → **uygulanmamış plan geri geliyor**.

**Karar:**

- Plan: armed alanı; GET /api/plan yalnız armed planı döndürür; içerik
  değişince armed=false; **Planı uygula** güncel taramadan yeniden kurar
  (taze hedef + guard) ve 10 dk başlatır; sayaç yalnız armed iken.
- Tarama: **POST /api/scan/verify** — hedef başına yalnız klasör yürüyüşü
  (dosya başına stat yok), şüpheli hedef tam ölçülür, kaybolan hedef
  listeden düşer, sonuç önbelleğe yazılır; UI açılışta çağırır ve bant
  gösterir ("6 hedef artık diskte yok (5.47 GB) — liste güncellendi").
- 24 saat kuralı **kaldırılmadı**; üzerine **karşılaştırma** eklendi
  (kullanıcının izin verdiği iki yoldan güvenli olanı).

**Paketler:** W2-g (plan armed/apply/GET süzgeci), W3-a (verify motoru +
uç + testler), W2-f+W3-b (web: panel × kaldırma, boşluk, sayaç yalnız
armed, doğrulama bandı).

## 24.10.2026 — Plan ömrü (W2-g) + bağımlılıklar Kanıt içinde (W2-e2)

- **W2-e2** (`f994386`): `DependenciesSection` — Kanıtlar içinde kapalı
  başlayan bölüm; tek istek, aynı sorguda tekrar istek yok,
  `aria-expanded`, durum rozetleri mevcut `graph.state.*` anahtarlarıyla.
  Disk `parts[0].path`, Araçlar `detail.command` sorgusu. Ayrı sekme YOK.
- **W2-g** (`27d0196`): `PlanResponse.armed`; içerik değişince
  `armed=false` + TTL yenilenir; `POST /api/plan/apply` planı **güncel
  taramadan yeniden kurar** (yeni planId, 10 dk o anda), taramada olmayan
  öğe → 409; `POST /api/plan/discard` uygulanmamış planı atar (armed → 409).
  **347/347**. Orkestratör düzeltmeleri: `rebuildPlan` yeni planı kurmadan
  eski kaydı silmiyor (hata halinde plan korunur); testte `status` tipi
  düzeltildi (`code` → `status`); girinti regresyonu.
- **Kullanıcı kararları (24.10):**
  · Kasa rozeti = **öğe sayısı**.
  · **"Son Tarama" tamamen kalkıyor** (yaş gerçeği yansıtmıyor) →
    **"Son Kasa işlemi"**.
  · Genel Bakış ölçüsü = **silinebilir tüm alan** (kullanımda olsun
    olmasın; kullanıcı temiz yapı isteyebilir).
  · **B kabul**: her açılışta tarama (12.1 s ölçüldü) + Ayarlar'da
    Her zaman / Günde bir / Elle; son ikisinde hızlı doğrulama.
  · Kasa **fiziksel taşıma**; aynı disk → kartta "Hâlâ diskte" notu.
- **Devir:** `docs/HANDOVER-2026-10-24.md`.
- **Sıradaki:** W5-a (src: scanOnLaunch + toplamlar + kasa sayacı),
  W5-b (web: açılış taraması, kart/rozet/not, dinamik başlık,
  "Son Kasa işlemi"), W2-f kalanı (panel `×`, boşluk, bant), W3-a
  (doğrulama ucu; daily/manual için).
- **Gerçek silme/plan çalıştırma YAPILMADI.**

## 25.10.2026 — oturum başı: işçi model Beam Free + baseline

- **İşçi model değişti (kullanıcı kararı, 25.10.2026):**
  `opencode-go/glm-5.3-flash` → **`opencode-go/beam-free`** (Beam Free,
  0 maliyet). `ORKESTRATOR.md` §2 güncellendi. Biçim aynı: ayrı görünür
  PowerShell penceresi, `opencode run --standalone --auto`, subagent YOK.
- **Baseline (kapı 1):** `npm run typecheck` temiz · `npm test`
  **347/347** · dal `orkestrator` @ `6d52541`, çalışma ağacı temiz.
- **Kuyruk:** W5-a → W3-a → W5-b → W2-f kalanı. W5-a ve W3-a
  `contract.ts`/`server.ts` dosyalarını paylaştığı için **paralel değil,
  sıralı** yürütülür.

### W5-a — TAMAMLANDI

- Commit `46a7a50` (işçi: **Beam Free**, `scratch/logs/w5a.log`,
  rapor `scratch/raporlar/w5a.md`).
- `src/core/contract.ts`: `ScanOnLaunchMode` + `SettingsResponse/Update`
  alanı; `DashboardTotalsView.scannedBytes|deletableBytes`;
  `DashboardLedgerView.count?`; `DashboardResponse.lastVaultAt`.
- `src/core/dashboard-summary.ts`: toplamlar **motorda**
  (`sum(totalBytes)` / `sum(reclaimableBytes)`), vault ledger `count`,
  `DashboardFacts.vault.lastAt`.
- `src/store/settings.ts`: `scanOnLaunch` (varsayılan `always`),
  `isScanOnLaunchMode` + `SCAN_ON_LAUNCH_MODES`; geçersiz değer varsayılana.
- `src/services/dashboard-service.ts`: `vault.lastAt = max(at)`
  (`Number.isFinite` koruması).
- **Beyaz liste sapması (kabul edildi):** `src/services/scan-service.ts`
  (+2 satır) — `SettingsResponse.scanOnLaunch` zorunlu alan olduğu için
  `settings()`/`updateSettings()` eşlemesi derleme gereği eklendi;
  davranış değişmedi.
- **Kapı:** typecheck temiz · **351/351** (+4) · yeni test
  `tests/scan-launch-setting.test.ts` (4) · `tests/dashboard-summary.test.ts`
  yalnız genişletildi (silinen/zayıflatılan test yok).
- **Risk:** toplamlar motorda; sunucu kendiliğinden tarama başlatmıyor.

### W3-a — TAMAMLANDI

- Commit `1049f33` (işçi: Beam Free, `scratch/logs/w3a.log`,
  rapor `scratch/raporlar/w3a.md`).
- `src/core/freshness.ts` (yeni): `probeDirs` — yalnız **klasör yürüyüşü**
  (`readdir withFileTypes`; dosya `stat`'ı yok), `lstat` + reparse biti ile
  junction/symlink atlanır, `maxDirs=20000`/`maxDepth=10`, limit aşılırsa
  `capped:true`. Uzun yol `longPath` ile.
- `src/services/scan-verify-service.ts` (yeni): `verifyScanTargets` —
  hedef başına `missing` / `skipped` (capped) / `ok` / `changed`;
  şüphe ölçütü `probe.newestMtime > scan.finishedAt`; şüphe varsa tam ölçüm
  (`MeasureCache.measure` ya da `walk({olderThanDays:[minAgeDays]})` —
  `buildDeleteTargets` ile **aynı** `olderBytes` kuralı).
  `deleteTargets` yalnız kalanlar, `reclaimableBytes` = kalan toplamı,
  `totalBytes` **değişmez**, `finishedAt` korunur, `verifiedAt` yeni alan.
  Girdi mutasyona uğramaz (derin kopya).
- `src/services/scan-service.ts`: `applyVerification(scan)` — bellek + kalıcı
  önbellek; `dirty.json`'a dokunulmaz.
- `src/core/contract.ts`: `ScanVerifyResponse`; `src/core/types.ts`:
  `ScanResult.verifiedAt?`.
- `src/web/server.ts`: `POST /api/scan/verify` (önbellek yokken `200` +
  `scanAt: null`).
- **Orkestratör düzeltmesi:** `applyVerification` içindeki
  `void saveScanCache(scan)` yakalanmamış ret üretebiliyordu →
  `.catch(() => {})` (bellekteki sonuç korunur, süreç düşmez).
- **Gerçek disk ölçümü (işçi):** `%USERPROFILE%\.nuget` 9.97 GB /
  14.723 klasör → `probeDirs` **1.93 s**, `verifyScanTargets` **1.58 s**,
  `capped=false`, `missing=0`, `changed=0` (mtime taramadan eski → tam ölçüm
  yapılmadı). Diske yazma/silme yok; tam tarama tetiklenmedi.
- **Kapı:** typecheck temiz · **351 → 358/358** (+7) · yeni test
  `tests/scan-verify.test.ts`.
- **Açık nokta (kabul):** `older` hedefte `minAgeDays` tanımsızsa ölçüm 0
  üretebilir; `buildDeleteTargets` her `older` hedefe 3/90 yazdığı için bugün
  ulaşılamaz — ileride savunma eklenebilir.

### W5-b2 — TAMAMLANDI

- Commit `5598995` (işçi: Beam Free, `scratch/logs/w5b2.log`,
  rapor `scratch/raporlar/w5b2.md`).
- `web/src/screens/Dashboard.tsx`: iki `ScanStamp` kullanımı kaldırıldı
  ("Son Tarama" yaşı artık Genel Bakış'ta yok); yerine **"Son Kasa işlemi"**
  (`data.lastVaultAt`, `null` → "Henüz kasa işlemi yok"); yeni **"Silinebilir
  alan"** paneli (`totals.deletableBytes` birincil, `totals.scannedBytes`
  ikincil); kasa defterinde `count` → "N öğe".
- `web/src/App.tsx`: rail'de yalnız Kasa için `rail-badge` (öğe sayısı),
  `> 0` iken; `title`/`aria-label` sayıyı içerir.
- `web/src/i18n.ts`: `dash.lastVault`, `dash.lastVault.none`,
  `dash.measure.title|deletable|scanned`, `ledger.items` (TR+EN);
  `ledger.vault.note` → **"Hâlâ diskte" / "Still on disk"**.
- `web/src/styles.css`: `.rail-badge`, `.ledger-count`, `.measure-primary|secondary`.
- **Kapı:** typecheck temiz · **358/358** (test sayısı değişmedi; web için DOM
  test altyapısı yok — görsel doğrulama tarayıcı turuna bırakıldı) ·
  `build:web` **459.31 kB / 129.09 kB gzip**.
- **Denetim notu:** `.ledger` flex-column, `.rail-item` flex-row olduğu için
  yeni düğümler düzeni bozmuyor; arayüzde hesap yok.

### W5-b1 — TAMAMLANDI + tarayıcı doğrulaması (ego-browser, 1440×900)

- Commit `b062073` (işçi: Beam Free, `scratch/logs/w5b1.log`,
  rapor `scratch/raporlar/w5b1.md`).
- `web/src/api.ts`: `verifyScan`, `discardPlan`, `applyPlan` sarmalayıcıları.
- `web/src/App.tsx`: açılış politikası — `launchRanRef` ile **yalnız ilk
  yüklemede**; `armed === false` plan `POST /api/plan/discard` ile atılır
  (`armed === true` korunur, 409 sessiz); `always` → `POST /api/scan` +
  2 sn'lik `scanStatus` yoklaması (en fazla 120 sn) + `load()`;
  `daily` → `POST /api/scan/verify`; `manual` → istek yok;
  `status.scanning` ise yeni istek gönderilmez.
- `web/src/screens/Settings.tsx` + `i18n.ts`: **"Açılışta tarama"** seçici
  (Her zaman / Günde bir / Elle) + TR/EN anahtarları.
- **Kapı:** typecheck temiz · **358/358** · `build:web` **461.28 kB /
  129.81 kB gzip**.

**Tarayıcı kanıtı (spaces 4, `scratch/ego/2026-10-25-w5/`):**

| Kontrol | Sonuç |
|---|---|
| Bundle | `/assets/index-41tcutz1.js` = yeni derleme (K15 temiz) |
| Başlık | "Son Kasa işlemi: 22 Eki 2026 20:55"; **"Son Tarama" yok** |
| Ölçü paneli | "SİLİNEBİLİR ALAN · 17.3 GB Silinebilir · Taranan: 48.1 GB" |
| Kasa defteri | "Kasada 5.5 GB / 6 öğe / Hâlâ diskte" |
| Rail rozeti | "6", `aria-label="Kasa (6)"` |
| Açılış taraması (`always`) | `POST /api/scan` → `tarama basladi` 16:31:12, `tamamlandi` 16:32:31 (**78.9 s**, 104 küme, 48.07 GB) |
| Tarama sonrası tazeleme | kart 26.8 → **17.3 GB**, üst çubuk "Son Tarama: az önce" |
| Ayarlar | "AÇILIŞTA TARAMA" + 3 seçenek; `daily` kaydedildi → `GET` aynı |
| `daily` modda açılış | 16:33:51 reload → **yeni tam tarama YOK**; `verifiedAt` yazıldı |
| `POST /api/scan/verify` | `200`, **24.9 s**, 40 hedef, `missing=0`, `changed=0`, `skipped=0` |
| EN | "Last vault operation", "DELETABLE SPACE", "6 items · Still on disk", "Vault (6)" |
| Ayar geri alma | doğrulama sonrası `scanOnLaunch` → **`always`** (varsayılan) |

**Bulunan iki kusur (yeni paketler):**

1. **Üst çubuk hâlâ "Son Tarama: az önce"** — kullanıcı kararı "Son Tarama
   tamamen kalkıyor". Metin motordan geliyor (`ScanStatusViewResponse.header`),
   arayüzde değil → **W5-c** (`core/scan-status-view.ts`).
2. **"Araçlarda: bilinmiyor" defter değeri karttan taşıyor** (uzun kelime,
   sağ kenarı aşıyor) → **W5-d** (yalnız `styles.css`).

**Ölçüm notu:** `always` tam tarama bu makinede **78.9 s** (24.10'daki 12.1 s
ölçümünden farklı: `minAgeDays=0` tam tarama + disk/Defender durumu).
`daily` doğrulaması **24.9 s** — "hızlı" beklentisinin üzerinde; hedefler
sıralı prob ediliyor → **W3-c** (paralel prob, hedef başına düşen süre).

### W5-c — TAMAMLANDI

- Commit `88a541b` (işçi: Beam Free, `scratch/logs/w5c.log`,
  rapor `scratch/raporlar/w5c.md`).
- `src/core/contract.ts`: `ScanHeaderKind` + `ScanStatusHeader` tipleri ve
  `ScanStatusViewResponse.header` alanı **kaldırıldı** (gereksizdi: chip
  zaten `kind` taşıyor).
- `src/core/scan-status-view.ts`: `private header()` ve `view().header`
  kaldırıldı; `kind`/`tone`/`reasons`/`rows`/`action`/`showAge` aynı.
- `web/src/components/ScanStatus.tsx`: rozet metni
  `t(SCAN_STATUS_LABEL[view.kind])` → "Tarama güncel", "Disk değişti",
  "Tarama eski", "Taranıyor", "Tarama yok".
- `web/src/i18n.ts`: `scan.header.age|none|scanning` (TR+EN) silindi.
- `tests/scan-status-view.test.ts`: `header` beklentileri yerine aynı
  senaryolarda `kind` + `rows` (yaş satırı) doğrulaması — **test sayısı
  düşmedi (358)**.
- **Kapı:** typecheck temiz · **358/358** · `build:web` **461.10 kB /
  129.71 kB gzip**.
- **Risk:** yaş bilgisi kaybolmadı (ayrıntı raporunda `scan.row.age` duruyor);
  arayüzde hesap yok.
- **Not:** işçinin bıraktığı "ayrnti" yazım hatası orkestratörce düzeltildi.

### W3-c / W5-d — paket metinleri hazır

- `scratch/gorev-w5d.md` (`unknown` defter değeri taşması; yalnız CSS +
  sınıf), `scratch/gorev-w3c.md` (doğrulamada eşzamanlılık 4, deterministik
  sıra korunur).

### W5-d — TAMAMLANDI

- Commit `895666f` (işçi: Beam Free, `scratch/logs/w5d.log`,
  rapor `scratch/raporlar/w5d.md`).
- `web/src/screens/Dashboard.tsx`: değer sınıfı
  `ledger-value` + bilinmeyen değerde `unknown`.
- `web/src/styles.css`: `.ledger { min-width: 0 }`,
  `.ledger-value { overflow-wrap: anywhere }`,
  `.ledger-value.unknown { font-size: 17px; letter-spacing: 0 }`.
- **Kapı:** typecheck temiz · **358/358** · `build:web` **129.72 kB gzip**.

### Tarayıcı turu 2 — ölçüm (space 4, `scratch/ego/2026-10-25-w5/`)

| Kontrol | Ölçüm |
|---|---|
| Rozet (W5-c) | `.scan-chip` = **"Scan current"**, sınıf `scan-current`; sayfada "Son Tarama"/"Last scan" **yok** |
| `unknown` taşması (W5-d) | 4 defterde `overflowPx = -15` (kartın **15 px içinde**), sınıf `ledger-value unknown` |
| Panelde çift `×` | 2 küme + 3 hedef planında panelde **5** `.rp-item-remove` (2 küme + 3 hedef) + Disk satırında aynı çıkarma → **çift** |
| `.rp-plan-head` binmesi | head `top=109`, sekmeler `bottom=95` → **+14 px boşluk**; iddia edilen 4 px binme **YOK** (kapatıldı) |
| Açılışta plan atma (W5-b1) | Sayfa yenilenince `armed=false` plan **otomatik atıldı** ("No items selected yet") |

- **Test artefaktı temizlendi:** oluşturulan plan `POST /api/plan/discard`
  (200), `scanOnLaunch` → **`always`**, sunucu kapatıldı.
  **Gerçek silme/plan çalıştırma YAPILMADI** (yalnız plan kuruldu ve atıldı).

### W6 — paket hazır (`scratch/gorev-w6.md`)

- Panelden tek tek `×` kaldırılır (**çıkarma satırda kalır** + "Tümünü
  boşalt"), açılış doğrulaması için **Disk bandı** (yalnız
  `missing`/`changed` varsa, sayılar `ScanVerifyResponse`'tan aynen).

### W6 — TAMAMLANDI

- Commit `26ac889` (işçi: Beam Free, `scratch/logs/w6.log`,
  rapor `scratch/raporlar/w6.md`).
- `web/src/components/PlannedModule.tsx`: küme + hedef satırlarındaki
  `.rp-item-remove` düğmeleri kaldırıldı, `onRemoveKey`/`onRemoveTarget`
  prop'ları silindi. "Tümünü boşalt" / "Yeni plan" korundu; süresi dolmuş
  uyarının kapatma `×`'i korundu.
- `web/src/App.tsx`: panel çıkarma bağlantısı (ölü `removePlanned`) kaldırıldı;
  `scanVerify` state'i + `Disk`'e `verifyNote`/`onDismissVerify`.
- `web/src/screens/Disk.tsx`: `role="status"` doğrulama bandı — yalnız
  `missing.length > 0 || changed.length > 0`; sayılar API'den **aynen**.
- `web/src/i18n.ts`: `disk.verify.missing|changed` (TR+EN);
  **orkestratör düzeltmesi:** `disk.planned.hint` artık "satırdaki düğmeyi
  kullanın" diyor (eski metin "sağ paneli kullanın" yanlış olmuştu).
- **Kapı:** typecheck temiz · **358/358** · `build:web` **129.98 kB gzip**.

**Tarayıcı kanıtı 3 — sentetik veri dizini (port 4412, kullanıcı verisi
ELLENMEDİ):** `%TEMP%\residue-w6-band-…` içinde 2 küme kuruldu: biri var olan
klasör, biri **kasıtlı olarak diskte olmayan** hedef.

| Kontrol | Sonuç |
|---|---|
| Açılış doğrulaması (`daily`) | kaybolan hedef bulundu, `POST /api/scan/verify` `200` |
| Bant | `role="status"`, **"1 hedef artık diskte yok (5.0 MB) — liste güncellendi"** + "Kapat" |
| Panel | `.rp-item-remove` = **0**; "Planı uygula / Yeni plan / Tümünü boşalt" var; önizleme salt okunur |
| Temizlik | sunucu kapatıldı, sentetik dizin **silindi** (kaldı mı: `False`) |

- **Gerçek silme/plan çalıştırma YAPILMADI**; sentetik plandaki hedefler
  yalnız `%TEMP%` altındaki sahte yollardı.

### W3-c — işçide (doğrulama hızlandırma)

- Paket: `scratch/gorev-w3c.md` — hedef probu **eşzamanlılık 4**, deterministik
  sıra korunur, aynı yol tek kez prob edilir. Ölçüm hedefi: 24.9 s → ~7 s.

### W3-c — TAMAMLANDI (+ W3-c2 test paketi)

- Commit `0c21723` (işçi: Beam Free, `scratch/logs/w3c.log`).
- `src/services/scan-verify-service.ts`: iki faz — hazırlık (`items[]`, küme +
  hedef sırası) → **`CONCURRENCY = 4`** ile ölçüm → sonuçlar indekse yazılır
  (çıktı sırası girdiyle **aynı**); `Map<path, Promise<DirProbe>>` ile aynı
  yol **tek okuma**; karar kuralları değişmedi.
- **Ölçüm:** 40 hedefte **24.9 s → ~6.3 s** (≈4×); `missing/changed/skipped`
  sonuçları aynı.
- **İşçi test eklemediği için W3-c2 açıldı** (`scratch/gorev-w3c2.md`):
  +3 test (sıra korunur, aynı yol iki hedefte, karışık durum) →
  **358 → 361/361**. Eşzamanlılık sabiti davranışsal olarak ölçülemediği
  (üretim koduna kanca yok) kod denetimiyle doğrulandı.
- **Orkestratör düzeltmesi (test zayıflatma engellendi):** işçi mevcut bir
  testten `assert.equal(body.missingBytes, 9)` **ve** sunucu kapatma satırlarını
  silmişti; ikisi de geri konuldu, test dosyasındaki girinti düzeltildi.
  Ayrıca `scan-verify-service.ts` sonundaki eksik satır sonu eklendi.
- **Kapı:** typecheck temiz · **361/361** (+3).
- **Not:** W3-c2 işçisi rapor dosyası yazmadı; kod diff'i ve test sayısı
  orkestratörce doğrulandı.

### W7 — işçide (kullanıcı istekleri, 25.10.2026)

1. Üst çubukta **"Bekleyen Plan"** düğmesi + altında **kalan süre**; tıklayınca
   Plan ekranı (`execute` yok, plan yoksa görünmez).
2. Marka (R + "Residue") **sola** hizalanır: `.topbar`
   `space-between` → `flex-start`, `.topbar-right { margin-left: auto }`.

### W7 — TAMAMLANDI (kullanıcı istekleri)

- Commit `b0e4df2` (işçi: Beam Free, `scratch/logs/w7.log`,
  rapor `scratch/raporlar/w7.md`).
- `web/src/App.tsx`: `.topbar-right` içinde, durum rozetinden sonra
  **"Bekleyen Plan"** düğmesi (`planned &&`), tıklayınca `setScreen('plan')`;
  `aria-label` statik ("… · 20:13'e kadar"), sayaç `aria-hidden`.
- `web/src/components/PlannedModule.tsx`: `PlanValidity`ye `compact` seçeneği
  (yalnız "kalan mm:ss"); **varsayılan davranış değişmedi** (sağ panel aynı).
- `web/src/styles.css`: `.topbar` → `justify-content: flex-start`,
  `.topbar-right { margin-left: auto }`, `.pending-plan` (iki satır, mono
  sayaç, odak halkası).
- `web/src/i18n.ts`: `top.pendingPlan` / `top.pendingPlanHint` (TR+EN).
- **Kapı:** typecheck temiz · **361/361** · `build:web` **462.08 kB /
  130.38 kB gzip**.

**Tarayıcı kanıtı 4 (1440×900, space "residue w7 ust cubuk"):**

| Kontrol | Ölçüm |
|---|---|
| Marka sola | `.brand.left = 62` (rail-toggle `right = 46` + 16 px gap) → hamburger'ın hemen sağında |
| Sağ grup | `.topbar-right.right = 1520` (viewport 1536 − 16 px padding) |
| Plan yokken | `.pending-plan` sayısı **0** |
| Plan varken | **1** düğme: "Pending plan / 09:44 left"; `aria-label` = "Pending plan · until 08:13 PM" (statik), sayaç `aria-hidden="true"` |
| Sayaç akıyor | 09:42 → 09:40 (2.5 s), **ağ isteği yok** |
| Yönlendirme | tıklama → rail aktif "Plan", `h1 = "Plan"`, URL değişmedi |

- **Test artefaktı temizlendi:** plan `discard` (200), `scanOnLaunch` →
  **`always`**, sunucu kapatıldı. **Gerçek silme/plan çalıştırma YAPILMADI.**

### Oturum özeti (25.10.2026)

- Commit'ler: `359cd8c` protokol · `46a7a50` W5-a · `1049f33` W3-a ·
  `5598995` W5-b2 · `b062073` W5-b1 · `88a541b` W5-c · `895666f` W5-d ·
  `26ac889` W6 · `0c21723` W3-c · `b0e4df2` W7 + 5 kayıt commit'i.
- Test: **347 → 361**. typecheck her adımda temiz. Bundle 129.09 → **130.38 kB gzip**.
- **Gerçek silme yapılmadı**; kasa değişmedi.

### Entegrasyon (kapı 6) + flake düzeltmesi

- `orkestrator` → `main` **fast-forward** (`9ef1377`), ardından flake düzeltmesi
  `6fd9b21` ile `main` güncellendi.
- **Ana repoda kapı:** typecheck temiz · **361/361** (iki ardışık koşu).
- **Bulunan flake:** `tests/scan-verify.test.ts` "karışık durum" testi,
  `finishedAt = Date.now()` ile `mkdir` aynı milisaniyeye düştüğünde NTFS
  alt-ms mtime yüzünden `okDir` "suspicious" sayılıp `changed` üretiyordu
  (`'changed' !== 'ok'`, main'de 1 hata). **Düzeltme:** `finishedAt` 5 s
  geçmişe alındı ve `okDir` mtime'ı `utimes` ile sabitlendi → deterministik.
  Orkestratör düzeltmesi (test doğruluğu), 3 ardışık koşu temiz.
- **Kopyalanan dosyalar:** `state.json` (wave **D6** + `lastSession`) ve
  `SESSION_LOG.md` (25.10.2026 devir notu) worktree'den **ana repoya** elle
  kopyalandı (gitignore'da).

## 25.10.2026 — devam: F5 (kanıt türü rozetleri)

- **T37 ön kanıtı (diskte arama, salt okunur):** `%APPDATA%\npm\node_modules`,
  `%LOCALAPPDATA%\npm-cache`, `%APPDATA%\npm-cache` → gizli `.paket-*`
  klasörü **YOK** (0/0/yok). T37 bugün **gerçek veriyle doğrulanamaz**;
  yalnız sentetik fixture ile test edilebilir.

### F5 — TAMAMLANDI

- Commit `fe8c1b7` (işçi: Beam Free, `scratch/logs/f5.log`,
  rapor `scratch/raporlar/f5.md`).
- `src/core/cli-inventory-types.ts`: `UsageSignal = 'state'|'history'|'atime'|'install'`;
  `CliTool.usageSignals` + `CliTool.atimeSuspect`.
- `src/core/cli-inventory.ts`: `usageVerdict()` dönüşüne `signals`
  (sabit sıra `install, state, atime, history`) + `atimeSuspect`
  (`installAtime`); **5 envanter üretim noktası** alanları dolduruyor.
  **Karar eşikleri değişmedi** (K17/K20, ≤2 sn kuralı aynı);
  `evidence: string[]` korundu.
- `web/src/screens/Tools.tsx`: satırda ve detay panelinde `.signal-badge`
  rozetleri (`atimeSuspect` uyarı tonunda); `i18n.ts` TR+EN 6 anahtar;
  `styles.css` `.badge.signal-badge`.
- **Kapı:** typecheck temiz · **361 → 365/365** (+4: F5-1..F5-4) ·
  `build:web` **463.16 kB / 130.95 kB gzip**.
- **Beyaz liste sapması (kabul):** `tests/cli-view.test.ts` ve
  `tests/inventory-atime.test.ts` +2 satır (fixture'a yeni zorunlu alanlar) —
  derleme gereği, test zayıflatma yok.
- **Orkestratör düzeltmesi:** `i18n.ts`'de iki anahtar tek satıra yapışmıştı
  (`tools.signals.hint` + `tools.manual`), TR ve EN'de ayrıldı.

**Tarayıcı kanıtı 5 (gerçek envanter, 14 araç):**

| Kontrol | Ölçüm |
|---|---|
| Rozetler | `.signal-badge` **41** adet; metinler "install", "access", "state", "atime = install" |
| K17 görünürlüğü | `browser` aracı: **"atime = install"** uyarı rozeti (atime kullanım kanıtı sayılmadı) |
| Durum/güven | Mevcut durum rozeti (`Unused/Unknown/Protected`) ve güven rozeti korunuyor |
| Yerleşim | 1440×900'de satırlar taşmıyor; rozetler durum rozetinin yanında |
| Envanter | `GET /api/cli/view` → 14 araç (SALT OKUNUR tarama) |

- **Gerçek silme/kaldırma YAPILMADI.**
- **Sıradaki:** W0-b (CLI/API parity) → T37 (sentetik fixture ile) → T74 W2.

## 26.10.2026 — orkestratör oturumu: durum hijyeni (B12)

- **Oturum kurulumu:** çalışma alanı orkestratör worktree'sine taşındı; gitignore'da
  olan `AGENTS.md`, `state.json`, `SESSION_LOG.md` ana repodan kopyalandı
  (main ile aynı commit: `8a3f8b3`).
- **Baseline (kapı 1):** `npm run typecheck` temiz · `npm test` **407/407**.
- **Doğrulanan gerçek durum (state.json ↔ kod):**
  - **T37** kodda bitmişti (commit `1b03faa`: classifier partial-install markeri,
    analyze yaş kapısı, `tests/partial-install.test.ts` 9 test) ama `todo` görünüyordu.
  - **T69** F1–F5 kapanmıştı (F5 = `fe8c1b7`) ama `todo` görünüyordu.
  - **B7–B11** düzeltilmişti fakat `status` alanı olmadığı için "5 açık hata" sayılıyordu.
  - **B12 (yeni):** `residue status` her açık hata satırını `! [undefined] undefined`
    basıyordu; `status --export` de aynı şekilde. Kök neden: `bugs[]` iki şema taşıyor
    (eski `{id,symptom,cause,fix,at}` / yeni `{title,symptom,cause,fix,status,severity}`),
    `src/commands/status.ts:71-74` ve `src/util/state.ts` `renderHandoff` ham alan
    okuyordu; `BugEntry` tipi alanları zorunlu ilan ettiği için TypeScript yakalamadı.
- **Görev paketi:** `scratch/gorev-durum-hijyeni.md`; işçi Beam Free ayrı pencerede
  (`scratch/logs/durum-hijyeni.log`). Beyaz liste: `src/core/bug-view.ts` (yeni),
  `src/commands/status.ts`, `src/util/state.ts`, `tests/bug-view.test.ts` (yeni).
- **Motor:** `BugViewList.normalize/open/counts` (saf TS, node builtin yok). Etiket:
  `title` > belirtinin ilk cümlesi (≤80) > `id` > `hata`; önem yoksa `unknown`;
  `status` yoksa **açık**. `status.ts` ve `renderHandoff` yalnız gösterir (kural 12/18).
- **Kapı 3 (ölçüm):** işçi "typecheck temiz" dedi ama **düştü** — yeni testte
  `noUncheckedIndexedAccess` yüzünden 7 × TS2532. Orkestratör mekanik düzeltme yaptı
  (`firstOf()` yardımcısı). Sonuç: typecheck **temiz** · **407 → 415/415** (+8).
- **Gerçek CLI kanıtı:** `residue status` → `! [unknown] [B7] Tarama surerken…`
  (5 satır, gerçek etiketler); `status --export` çıktısında `undefined` **0**.
- **Kapı 4 (inceleme):** diff yalnız beyaz listede; güvenlik kapısı, `report-only`,
  onay dili ve `state.json` değişmedi. Kapsam dışı dosya yok.
- **state.json (orkestratör verisi):** T37 + T69 → `done`; B7–B11 → başlık + önem +
  `fixed`; B12 eklendi (`fixed`). Sonuç: **73 tamam / 0 yarıda / 0 todo / 0 açık hata**.
- **Gerçek silme YAPILMADI**; kasa ve disk değişmedi.
- **Sıradaki:** W0-b (CLI E2E + CLI/API parity + perf/load eşiği) veya B19
  (iptal geri bildirimi, web). Karar kullanıcıya soruldu.

### W0-b-1 — CLI-01…06 otomatik E2E (26.10.2026)

- **Bulgu kaynağı:** `docs/READINESS-MATRIX.md` §5.1 (CLI-01…06 hepsi 🟡) ve §4 alpha
  maddesi 3 (`npm test` içinde gerçek CLI E2E yok). Alpha eşiği 70; skor 68.
- **Orkestratör ön doğrulaması (gerçek komutlar, 26.10.2026):** sandbox env ile
  `scan --json --quiet --root` 21 ms / exit 0 / 0 silme hedefi (report-only),
  `clean --dry-run --env temp` 452 ms / exit 0 / DRY-RUN, `inventory --json` 408 ms /
  exit 0 / fixture `source=npm-global`, `repair --dry-run` 293 ms / exit 0,
  `quarantine` (arg yok) exit 1 + kullanım, `quarantine <ad>` exit 1 + standalone yok,
  `status` + `log --summary` exit 0.
- **Görev paketi:** `scratch/gorev-cli-e2e.md`; işçi Beam Free (`scratch/logs/cli-e2e.log`).
  Beyaz liste **tek dosya**: `tests/cli-e2e.test.ts` (yeni). Ürün kodu değişimi yasak.
- **Sonuç:** 6 test (CLI-01…06), gerçek `node bin/residue.mjs` süreci; sandbox
  (`LOCALAPPDATA`/`APPDATA`/`USERPROFILE`/`TEMP` geçici dizin, `PATH` yalnız node,
  `RESIDUE_*`/`CLICLEANER_*`/`npm_*` temizlenir). `after()` sandbox'ı siler.
- **Kapı:** typecheck **temiz** · **415 → 421/421** (+6) · süre 2.7 → 4.8 sn.
- **Kabul edilen sapma (işçi raporu):** fixture `package.json`a `bin` alanı eklendi;
  ürünün npm-global algılaması komutu `bin`den türetiyor. Ürün kodu değişmedi,
  beklenti gevşetilmedi.
- **Test zayıflatma yok:** report-only (0 hedef), 0 silme, vault oluşmaması,
  `ONAR` istemi olmaması ve fixture'ların yerinde kalması ayrı ayrı doğrulanıyor.
- **Matris:** CLI-01…06 → ✅ (tarih + dosya kanıtı), alpha maddesi 3 ✅; alpha hâlâ
  ❌ (parity + perf). §7 risk 3 → "Parity yok".
- **Gerçek silme YAPILMADI**; gerçek `%TEMP%`, gerçek veri dizini ve kurulu araçlar
  üzerinde işlem yapılmadı.
- **Sıradaki:** W0-b-2 (PARITY-01…05, süreç düzeyi) → W0-b-3 (PERF-01…03 eşikleri).

### B13 — kasa geri yükleme sağlamlığı (26.10.2026, kullanıcı raporu)

- **Kullanıcı raporu:** kasada 6 öğe; 4'ü geri yüklendi, 1'i "Klasör dolu" hatası verdi,
  1'i tıklamaya cevap vermedi.
- **Orkestratör kanıtı (salt okunur):**
  - `%LOCALAPPDATA%\residue\vault` → 6 parti; 4'ü boş (25.10 20:35'te dönen updater
    öğeleri), 2'si dolu: `Local\uv` (2.5 GB / 69.664 dosya) ve `Local\rattler`
    (2.7 GB / 47.437 dosya). İki hedef yol bugün de diskte (yeniden yaratılmış).
  - `audit.log`: 25.10.2026 20:35'te **4** `vault.restore` (`mode=files`, `verified=true`);
    başarısız iki deneme için **hiç kayıt yok** — `audit` yalnız başarıdan sonra çağrılıyordu.
  - `src/actions/vault.ts:353-367`: `rename` yalnız `EXDEV/EPERM/EACCES` için cp yedeğiyle
    tekrar deneniyordu; `ENOTEMPTY/EEXIST/ENOTDIR` yeniden denenmiyordu.
  - `web/src/screens/Vault.tsx`: tek `busy` bayrağı **tüm** satırları disabled yapıyordu →
    ikinci tıklama sessizce yutuluyordu ("cevap vermedi").
- **Görev paketi:** `scratch/gorev-b13-kasa-restore.md` (işçi Beam Free,
  `scratch/logs/b13-kasa.log`). Beyaz liste: `src/actions/vault.ts`,
  `src/core/restore-target.ts` (yeni), `tests/vault-restore.test.ts` (yeni),
  `web/src/screens/Vault.tsx`, `web/src/i18n.ts`.
- **Windows kök neden matrisi (işçi ölçümü, gerçek `fs.rename`):** hedef yok → OK;
  hedef boş klasör → `EPERM`; hedef dolu klasör → `EPERM`; hedef `.restored-<now>` →
  `EPERM`; hedef **dosya** → sessizce üzerine yazma (nadir yarış); hedef ebeveyni dosya →
  `EINVAL`. Yani "klasör dolu" sınıfı Windows'ta `EPERM` olarak dönüyor; eski kod bu
  kodu cp-yedeğine düşürüp **mevcut klasörün içine birleştiriyordu** (sessiz karışma).
- **Düzeltme:** saf `RestoreTarget` (initial/retry/isRetryableCode) + `restoreVaultEntry`
  içinde en fazla 3 deneme, benzersiz `<yol>.restored-<zaman>-<deneme>-<rastgele>`,
  hedef asla ezilmez, başarısızlıkta manifest temizliği yok, her başarısızlık
  `vault.restore.failed` audit kaydı (`code`, `reason`, `attempts`). Başarılı kayıt
  artık `attempts` taşıyor.
- **Arayüz:** `busyId` satır bazlı + satır içi hata metni (`danger-text`) + meşgulken
  başka satıra tıklamada "Başka bir geri yükleme sürüyor" bilgisi; kasa boşaltma ayrı
  `purgeBusy` bayrağı ve geri yükleme ile eşzamanlı çalışmıyor (orkestratör düzeltmesi).
- **Kapı:** typecheck temiz · **421 → 430/430** (+9) · `build:web` yeşil (137.34 kB gzip).
- **Veri güvenliği:** hiçbir hedef ezilmiyor; testler yalnız `mkdtemp` sandbox kullanıyor;
  gerçek kasaya/veri dizinine yazılmadı. **Kullanıcının uv/rattler kayıtlarına dokunulmadı**
  — hedefleri diskte olduğu için yeni kod onları `.restored-<zaman>` adına çıkarır.
- **Açık kalem:** (B23) `rename` hedefte dosya varsa sessizce üzerine yazıyor — akıştaki
  ön kontrol bunu engelliyor ama yarış penceresi kapatılmadı.
- **Yeni backlog (B22):** kullanıcı sorusu — "silinen/geri alınan öğelerin denetim geçmişi
  yok mu?" Cevap: **dosya var (audit.log JSONL), okuyucusu yok**
  (`src/util/audit.ts`: "okuma araci yoktur"). `delete.done`, `vault.restore`,
  `vault.purge-*` kayıtları tutuluyor ama ne CLI ne arayüz gösteriyor.

### B22 — denetim geçmişi görünürlüğü (26.10.2026, kullanıcı sorusu)

- **Kullanıcı sorusu:** "Geri alınan ve/veya silinen öğeleri tutan bir audit geçmişi yok mu?"
  Orkestratör cevabı: **kayıt var, okuyucu yok** — `src/util/audit.ts` başlığında
  "JSONL yazilir; okuma araci yoktur" diyor; ne CLI ne arayüz gösteriyordu.
- **Doğrulanan olay yükleri** (çağrı yerlerinden): `delete.high-ack`, `delete.done`
  (`{freed, removed, skipped, failed, journal}`), `delete.error`, `vault.restore`,
  `vault.restore.failed` (B13), `vault.purge-items`, `vault.purge-all`.
  `journals/<opId>.jsonl` `kind:"item"` satırları gerçek **yol + bayt** taşıyor;
  `delete.done` içindeki `journal` alanı o dosyayı gösteriyor.
- **Görev paketi:** `scratch/gorev-b22-denetim.md` (işçi Beam Free,
  `scratch/logs/b22-denetim.log`). Beyaz liste 12 dosya; **yalnız okuma** şartı.
- **Motor (saf TS):** `src/core/audit-view.ts` → `AuditView.parse / parseLines / filter /
  counts`; olay sınıflandırma (`delete|restore|purge|other`), `ok = !(.failed|.error)`,
  `path` sırası `to → from → items[0]`, sayaçlar (`removed/freed/skipped/failed/batches/bytes/items`),
  bozuk satır atlanır, sıralama en yeni önce.
- **Servis:** `src/services/audit-service.ts` (IO): son **5000 satır**, `limit` üst sınırı 500,
  `delete.*` için journal'dan en fazla **200** yol (best-effort), `journals/` sayımı,
  `audit.log` yoksa boş liste (hata değil).
- **Sözleşme:** `AuditEventView` + `AuditResponse` (`counts` = **dosyadaki** toplamlar,
  `journalCount`, `auditFileExists`).
- **CLI:** `residue audit [--since 24h|7d] [--kind …] [--limit N] [--json]`; başlık
  `(gösterilen / dosyada)` ayrımı (orkestratör düzeltmesi), satırda tür + sonuç + boyut + yol.
- **API:** `GET /api/audit` (token kapısı aynı); `kind`/`since` geçersizse **400**.
- **Arayüz:** Kasa ekranında **Kasa / Denetim** sekmeleri; salt okunur tablo
  (tarih, tür, sonuç rozeti, yol + hedefler, boyut), sayaç satırı, kayıt yoksa `EmptyState`.
  Tablo başlıkları orkestratör tarafından i18n'e taşındı (`audit.col.*`), inline TR/EN kaldırıldı.
- **Kapı:** typecheck temiz · **430 → 446/446** (+16) · `build:web` yeşil.
- **Gerçek veri kanıtı:** `residue audit` → **5 olay**: 4 geri yükleme (25.10 23:35) +
  1 silme (22.10 20:55, journal'dan `rattler, uv, @opencode-aidesktop-updater +3`).
  Komut öncesi/sonrası `audit.log` **1056 B / 25.10 23:35** — değişmedi (salt okuma).
- **Gerçek tarayıcı doğrulaması YAPILMADI** (Denetim sekmesi); build + tip kapısı yeşil,
  sekme bir sonraki tarayıcı turunda kontrol edilecek.
- **Açık kalem:** arayüzde tarih aralığı/tür filtresi yok (v1 yalnız liste); `B22` devamı
  olarak eklenebilir.

### B22 tarayıcı doğrulaması (26.10.2026, ego-browser space 6)

- **K15 sırası uygulandı:** 4300–4500 portlarında eski süreç yok (0 dinleyici) →
  `node bin/residue.mjs ui --web --no-browser --port 4411` → kök `HTTP 200`,
  bundle `index-BpSLwB6v.js` (yeni derleme). Sunucu doğrulamadan sonra kapatıldı
  (**0 dinleyici** kaldı), otomatik tarama da süreçle birlikte durdu.
- **TR/Denetim sekmesi:** sekmeler `Kasa` (pasif) / `Denetim` (aktif);
  başlıklar **Tarih · Tür · Sonuç · Yol / hedefler · Boyut** (i18n `audit.col.*`);
  **5 satır** — 4 geri yükleme (25 Eki 23:35) + 1 silme (22 Eki 20:55) ve silme
  satırında journal'dan gelen **hedefler: rattler, uv, @opencode-aidesktop-updater +3**
  ile **5.5 GB**. Hata bandı yok (`banner.danger` = null).
- **EN:** dil düğmesi → sekmeler `Vault` / `Audit`, başlıklar
  `Date · Type · Result · Path / targets · Size`, sayaç satırı
  `total: 5 · delete: 1 · restore: 4 · purge: 0 · failed: 0`, `html lang="en"`;
  satırlar da EN (`Oct 25, 2026, 11:35 PM`, `delete`, `ok`).
- **Kasa sekmesi (regresyon):** 2 satır (`Local\uv`, `Local\rattler`), her satırda
  **etkin** `Restore` düğmesi — B13'teki `disabled={busyId === entry.id}` davranışı
  doğru: satırlar artık global `busy` ile kilitlenmiyor.
- **Bilinçli olarak YAPILMAYAN:** gerçek geri yükleme tıklanmadı (2.5 + 2.7 GB veri
  taşır; kullanıcı kararı). Satır içi hata/meşgul mesajları bu turda tetiklenmedi.
- **Ekran görüntüleri:** `scratch/audit-tr.png`, `scratch/audit-en.png`
  (gitignore'da; ürüne girmez).
- **Sıradaki:** W0-b-2 (parity) veya B24 (denetim filtresi + dışa aktarma).

### W0-b-2 — PARITY-01…03 süreç düzeyi (26.10.2026)

- **Kapsam:** `docs/READINESS-MATRIX.md` §5.6. Önceki durum: yalnız motor düzeyi parity
  (`tests/parity.test.ts`); adaptör (CLI JSON ↔ HTTP yanıtı) test edilmiyordu.
- **Görev paketi:** `scratch/gorev-w0b2-parity.md` → işçi Beam Free
  (`scratch/logs/w0b2-parity.log`). Beyaz liste **tek dosya**: `tests/parity-e2e.test.ts`
  (yeni). Ürün kodu değişimi yasak.
- **Test altyapısı:** tek sandbox + iki adaptör — gerçek `node bin/residue.mjs` çocuk süreci
  ve **in-process** `createApiServer`; sandbox env hem `process.env`e (API için) hem çocuk
  sürece verilir, `after()` eski değerleri geri yazar.
- **BULGU 1 (ürün davranışı, tasarım gereği):** PARITY-01 ilk kurgusu (`scan --root` ↔
  `GET /api/disk`) **ürünle çelişiyordu**: `ScanService.runJob` kök taramalarını bilerek
  `lastScan`e yazmıyor (T27/T10 — kısmi proje taraması "son tam tarama" gibi görünmesin).
  API `/api/disk` bu yüzden boş dönüyordu. **Ürün değiştirilmedi**; test yeniden kuruldu:
  - PARITY-01: env kapsamlı tarama (`--env temp`) iki adaptörde; küme anahtarı sırası,
    `totalBytes`, `reclaimableBytes`, hedef yolu kümesi ve karar türü eşit; her iki tarafta
    en az bir hedef (boş eşitlik kanıt sayılmaz).
  - **PARITY-01b (yeni):** kök taraması `/api/disk`i **değiştirmez** — T27/T10 tasarımı
    artık sistematik beklenti.
- **BULGU 2 (test izolasyonu, orkestratör düzeltmesi):** PARITY-03 `npm test` ile
  çalıştırıldığında kırmızı, doğrudan `node --test` ile yeşildi. Kök neden: npm
  `npm_config_prefix` değişkenini gerçek global prefixe işaret ederek enjekte ediyor;
  CLI çocuk süreci `npm_*` değişkenlerini temizlediği için sandbox APPDATAya düşüyor,
  in-process API ise gerçek prefixi görüyordu. Düzeltme: sandbox anahtar listesine
  `npm_config_prefix` + `NPM_CONFIG_PREFIX` eklendi (kaydet → sil → geri yaz).
- **Kapı:** typecheck temiz · **446 → 450/450** (+4) · **iki ardışık temiz koşu** ·
  doğrudan `node --test` koşusunda da 4/4.
- **Matris:** PARITY-01, 01b, 02, 03 → ✅; PARITY-04 (graph) ve PARITY-05 (project) → ❌
  **T79** olarak ayrıldı (derived-view normalizasyonu + proje kök yapılandırması gerekir).
- **Gerçek silme YAPILMADI**; `clean` yalnız `--dry-run`; gerçek `%TEMP%`/veri dizini
  kullanılmadı; kasa değişmedi.
- **Sıradaki:** W0-b-3 (PERF-01…03 eşikleri) veya T79 (PARITY-04/05).

### W0-b-3 — performans/yük ölçümü + yazılı bütçe (26.10.2026)

- **Kapsam:** matris §5.8 + alpha maddesi 5. Performans (5) ve yük (5) alt skoru 0 idi;
  alpha kapısı 70, skor 68.
- **Görev paketi:** `scratch/gorev-w0b3-perf.md` → işçi Beam Free (`scratch/logs/w0b3-perf.log`).
  Beyaz liste: `scripts/perf.mjs`, `scripts/perf-budget.json`, `tests/perf-budget.test.ts`,
  `package.json` (yalnız `perf` betiği).
- **Ölçümler (taban):** PERF-01 10k dosya tarama **1856 ms / 30.4 MB RSS**; PERF-02 100 küme
  DiskView+JSON p95 **1.82 ms**; PERF-03 kasa taşıma **4304 dosya/sn**; LOAD-01 100k dosya
  **8.7 sn / 22.4 MB**; LOAD-04 10 eşzamanlı istek p95 **146 ms**, 5xx **0**.
- **Kapı:** typecheck temiz · **450 → 453/453** (+3) · `npm run perf` → **PERF TEMİZ** (177 sn).
- **ORKESTRATÖR BULGUSU (eşik kalibrasyonu):** ilk bütçe "ölçülen × 2" kuralıyla yazıldı;
  aynı makinede bir sonraki koşu **diskView100 p95 4.12 ms > 4** ve
  **load100k 19.9 sn > 17.4 sn** ile kapıyı kırdı. Sapma gerçek: 100k taramada **2.3x**
  (disk önbelleği + eşzamanlı yük). Bütçe **taban + en kötü gözlem** üzerinden yeniden
  kalibre edildi (`measured` + `worstObserved` + `rationale` alanları eklendi):
  scan10k 6000 ms, RSS 90 MB, diskView100 12 ms, kasa ≥1500 dosya/sn, load100k 45 sn,
  RSS 90 MB. Sonraki koşu: **PERF TEMİZ**.
- **Dürüstlük notu:** 2x kuralı tek başına yetersizdi; eşik dosyası artık hem taban hem en
  kötü gözlemi taşıyor ve gerekçesini yazıyor (uydurma eşik yok).
- **Gerçek silme YAPILMADI:** `clean` hiç çağrılmadı; kasa taşıma ölçümü yalnız sandbox
  fixture'ında `deleteTarget` ile yapıldı.
- **Kalan:** LOAD-02 (5k küme sanal liste), LOAD-03 (1k SSE olayı) ve T79 (PARITY-04/05).

### T79 — PARITY-04/05 süreç düzeyi parity (27.10.2026)

- **Kapsam:** matris §5.6. PARITY-01…03 T78 altyapısını kullanıyordu; graph ve project
  için **derived view** normalizasyonu gerekiyordu (zaman duyarlı alanlar).
- **Görev paketi:** `scratch/gorev-t79-parity45.md` → işçi Beam Free
  (`scratch/logs/t79-parity45.log`). Beyaz liste: yalnız `tests/parity-t79.test.ts` (yeni).
- **Test (3):** PARITY-04 `residue graph --json` ↔ `GET /api/graph`; PARITY-04b what-if
  (`--what-if ornek-arac` ↔ `POST /api/graph/what-if`); PARITY-05
  `residue project <dir> --json` ↔ `GET /api/projects?path=`.
- **Normalizasyon sözleşmesi (dosya başında yazılı):** eşit sayılan = düğüm id kümesi,
  kind/label/path/role/level, kenar (from,to,kind,strength,state) kümesi, cycles kanonik,
  rootCauses label+count, summary nodes/edges/cycles/broken. Kapsam dışı (zamana duyarlı):
  node.meta/active/group/dependents/needs, edge.evidence/id/active, groups, details.
  **Boş eşitlik kapısı:** graph ≥2 düğüm ve ≥1 kenar, project ≥1 artifact; aksi halde
  test "boş = boş" diye geçemez.
- **Ürün bulgusu YOK.** Tek fark: CLI `project --json` `installCommand/verifyCommand`
  alanlarını `artifact.recipe.*` altında taşıyor, API üst düzeyde → test eşlemeyi yapıyor
  (sözleşme farkı, hata değil).
- **Kapı:** typecheck temiz · **453 → 456/456** (+3) · commit **`16f29db`**.

### B23 — kasa geri yüklemede ezme yarışı (27.10.2026)

- **Kusur (B13'ün kök nedeni):** `moveBack` = `rename` (Windows'ta **var olan dosyayı
  sessizce ezer** — ölçüldü) + EXDEV yedeğinde `cp({force:true})` + doğrulamasız `rm(src)`.
- **Üç tur işçi (hepsi Beam Free), orkestratör incelemesi her turda:**
  1. **B23:** `moveToTargetExclusive` (dosya: `COPYFILE_EXCL` + `utimes(Date)` + boyut
     doğrulama; klasör: `rename` → `cp({force:false,errorOnExist:true})` + `verifyCopy`),
     `RestoreOptions.beforeMove` test kancası, 6 test. **Kapı 456 → 462.**
  2. **B23-b (orkestratör bulgusu):** dosya/klasör dalında `EEXIST` dışı hatada
     `removeQuiet(dst)` **yabancı hedefi siliyordu** → `existedBefore` kapısı; symlink
     dereference (`copyFile` bağı izliyordu) → yalnız `rename`. 9 test. **Kapı 462 → 465.**
  3. **B23-c (orkestratör bulgusu, gerçek ölçüm):** `rename` hâlâ iki yerde koşulsuzdu;
     Windows'ta `rename(dosya → var olan dosya)` **ezdiği** `node -e` ile kanıtlandı
     (`dst` içeriği kaynakla değişti). Düzeltme: symlink `readlink` + `symlink()` (atomik
     `EEXIST`, ayrıcalık yoksa `ELINK` — kopyalama yok), klasör/dosya dalında
     `existedBefore === true` ise `rename` **hiç denenmeden** `EEXIST`. 13 test.
- **ORKESTRATÖR DÜZELTMESİ (birleştirme):** B23-c turu EXDEV yedeklerinde
  `utimes`/boyut doğrulaması ve `verifyCopy` adımlarını **düşürmüştü**. İki sürüm
  birleştirildi: `existedBefore` kapıları + `symlink()` (b23c) **ve** damga koruma +
  boyut doğrulama + `verifyCopy` (b23b) birlikte.
- **Kapı (orkestratör kendi koştu):** typecheck temiz · **469/469** ·
  `tests/vault-rename-race.test.ts` 13 · `tests/vault-restore.test.ts` 9/9.
- **Olay (kayda geçiyor):** B23-c işçisi worktree yerine **ana repoda** çalıştı; raporu
  doğruydu ama benim worktree kopyam eski kaldı. Ders: **işçi raporu tek başına kanıt
  değil** — `git status` + dosyada `grep` ile fiili değişiklik doğrulanır, sürüm
  farklıysa birleştirme yapılır (K15'in kardeşi: "hangi kopya?" sorusu).

### Oturum kapanışı — arşiv kararı ve devir (27.10.2026)

- **Kullanıcı kararı:** `docs/CLI-REMOVE-PLAN-REMOVAL.md` depoya alınsın. Belge
  **zaten uygulanmış** bir planı gelecek zamanla anlatıyordu (CLI plan sistemi
  26.10.2026'da kaldırıldı; `removeSingleTool`, `POST /api/cli/remove`,
  `web/src/panel-plan.ts` → `tools: { modules: ['evidence','action'] }`).
  Kural 8 gereği içerik aynen alınmadı: başlığa ve kapanışa **"UYGULANDI
  (26.10.2026) — karar kaydı"** notu, güncel davranışın yeri eklendi. Commit `7475215`.
- **Devir eki:** `docs/HANDOVER-2026-10-27.md` §4/2 kapatıldı (commit `491014a`).
- **Dal hijyeni:** `orkestrator` → `main` fast-forward; iki çalışma ağacı da
  `491014a` üzerinde ve temiz. `state.json` (gitignore) ana repoya kopyalandı.
- **Kapı:** kod değişmedi; son kod commit'i `a8e7110` üzerinde typecheck temiz +
  **469/469** doğrulandı (main, 5 sn). Sonraki iki commit **yalnız belge**.
- **Kalan:** B24 (görev paketi hazır), LOAD-02/03 (T83), T74/W2 personası,
  UX-042/B19/B21 · kullanıcı kararı: `Local\uv` + `Local\rattler` (kasada).

---

### B24 — denetim geçmişi filtresi + dışa aktarma (28.10.2026)

- **Başlangıç kapısı:** iki ağaç da `7ddb989` üzerinde temiz; typecheck temiz,
  **469/469**. Paket (`scratch/gorev-b24-denetim-filtre.md`) kod doğrulanarak
  yeniden yazıldı: gerçek çapalar `src/web/server.ts:1130` (`GET /api/audit`),
  `web/src/api.ts:294`, `web/src/screens/Vault.tsx:39-58` + tablo `:283-331`,
  `src/core/audit-view.ts:33`, `src/core/contract.ts:469-489`.
- **Paket hatası (tasarım):** arayüzün `src/core/audit-view.ts`'i import etmesi
  isteniyordu; `tests/shell-boundary.test.ts:33-45` web'e yalnız `contract.ts` +
  `approval.ts` izni veriyor. **Karar:** saf motor `src/core/audit-export.ts` +
  boundary'ye tek dosya istisnası (kural 18 gereği biçim kuralı motorda kalır).
- **Paket hatası (veri):** "limit 5000 ile tümü" yanlış;
  `src/services/audit-service.ts` `if (limit > 500) limit = 500;` +
  `lines = allLines.slice(-5000)`. Dışa aktarma `AUDIT_EXPORT_LIMIT = 500`;
  tavana ulaşınca dürüst "en yeni N kayıt" notu (`audit.export.truncated`).
- **İşçi turu (Beam Free)** sonrası orkestratör mekanik düzeltmeleri:
  `setExportTruncated(false)` `loadAudit` başında; uydurma `chip-row` sınıfı →
  var olan `kind-tabs` (`web/src/styles.css:2460`); tautolojik assert
  (`… || false`) gerçek kaçış kontrolüne çevrildi + satır sonu testi eklendi.
- **Kapı:** typecheck temiz · **484/484** · `build:web` yeşil
  (JS 494.03 kB / gzip 139.80 kB, CSS 56.67 kB / 10.32 kB, `index-DaUSZ7Re.js`).
- **Tarayıcı (ego-browser, port 4423, yeni bundle):** TR çipler + `aria-pressed`
  doğru; `silme` filtresi 5 → 1 satır; CSV içeriği (BOM, ISO tarih, `; ` birleşik
  6 hedef, `ok=true`) ve JSON (`version/count/records`) indirilen dosyadan
  doğrulandı; EN etiketleri doğru; JS hatası yok. Ekran görüntüsü CDP zaman aşımı
  (bilinen sorun).
- **Commit:** `fd87707`. Devir: `docs/HANDOVER-2026-10-28.md`.

---

### T83 — LOAD-02/03 yük ölçümü + bütçe (28.10.2026)

- **Başlangıç:** `e17fdde` üzerinde typecheck temiz, **484/484**.
- **Paket:** `scratch/gorev-t83-load.md`; doğrulanmış çapalar
  `src/services/scan-service.ts:342-351` (2000 olay tavanı),
  `src/web/server.ts:1235-1257`
  (`canReplay = lastId > 0 && (job.events.length === 0 || lastId >= firstId - 1)`),
  `scripts/perf.mjs`, `scripts/perf-budget.json`, `tests/perf-budget.test.ts`.
- **Orkestratör probu (paket için ölçüm):** 30 önbellek klasörü → **181** olay
  (1 `targets` + 30 `target-start` + 30 `target-done` + 30 `item` + 90 `progress`),
  yani küme başına ~6 olay; 350 küme ≈ 2100 > 2000 tavan.
- **İşçi turu (Beam Free):** `SCAN_EVENT_BUFFER` sabiti, LOAD-02/03 blokları,
  3 bütçe, `tests/sse-resume.test.ts` (5 test). İddia: 489/489 + perf temiz.
- **Orkestratör düzeltmeleri:** beyaz liste dışı üretilen
  `docs/T83-LOAD-REPORT.md` silindi (içerik bu bölüme + devire taşındı);
  tavan kanıtı zayıftı → perf'e "tam tampon = 2000 olay (403..2402)" ve
  "tampon dışı istek = anlık görünüm" kontrolleri, teste **F** (tam BUFFER
  olay) eklendi → **490/490**.
- **Kapılar (orkestratör kendi koştu):** typecheck temiz · **490/490** ·
  `npm run perf` **iki kez** `PERF TEMİZ`.
  1. koşu (measured): 5000 küme p95 **49.55 ms**, payload **1.90 MB**,
    replay p95 **159.55 ms**, toplam olay **2403**.
  2. koşu: 25.22 ms / 1.90 MB / 122.95 ms. `worstObserved` = 1. koşu.
  Bütçeler: `load5000DiskViewP95Ms` 150 · `load5000PayloadMb` 6 ·
  `load1kReplayP95Ms` 500 (en kötü gözlemin ~3×'ü).
- **Gerçek tarayıcı (ego-browser, port 4424, izole `LOCALAPPDATA`, 5000 klasör
  fixture):** tarama 32.2 s → **5.000 küme**; `/api/disk` **3507 kB / 135 ms**;
  DOM satırı **15** (üst) → **23** (orta) → **15** (alt);
  `scrollHeight` 220000 px; son satır `app-4999`; JS hatası yok.
- **Ders (tarayıcı ölçümü):** uzun beklemeyi `page.evaluate` içine koyma
  (15 s sınırı); evaluate zaman aşımına uğrayınca sayfa SSE `done` olayını
  kaçırdı ve liste boş kaldı (rozet "Tarama güncel"), reload sonrası geldi.
- **Commit:** `188af10` (kod + test). Belge commit'i aşağıda.
- **Açık risk:** replay p95 makine yüküne duyarlı (159 ms; bütçe 500 ms);
  payload ölçümü sentetik kümede 1.90 MB, gerçek veride 3.5 MB (JSON alanları
  daha zengin) — bütçe sentetik ölçüye göre kalibre edildi.

---

### UX-042 — açık kalemden çıkarıldı (28.10.2026, kullanıcı onayı)

- **Kullanıcı kararı:** UX-042 (alt kartların tıklanabilirliği) önceki yeniden
  tasarım fazında **başka bir yöntemle** çözüldü; açık işlerden silinecek.
- **Kodda doğrulama (tahmin değil, kanıt):**
  `web/src/screens/Dashboard.tsx:252-253` → defter kartları
  `className={`ledger ledger-${ledger.id}…`}` + `aria-pressed={selectedId === ledger.detailId}`;
  detay motoru `src/core/dashboard-details.ts:60` (`class DashboardDetails`);
  `web/src/panel-plan.ts:60` → `dashboard: { modules: ['evidence','planned','context'] }`
  (detay sağ panel **Kanıtlar** modülünde). Risk kartları statik `<article>`.
- **Kapatılan kayıtlar:** `docs/HANDOVER-2026-10-28.md` §4 tablosundan satır
  kaldırıldı + kapanış notu; `docs/UX-LOG.md` UX-042 bölümüne tarihli onay
  notu. Tarihsel oturum kayıtları (26.10/27.10) **değiştirilmedi** — onlar
  o günkü durumu anlatır.
- **Ek not (süreç):** bu tür "açık kaldı" ifadeleri artık UX-LOG durumu ile
  çapraz kontrol edilecek; UX-LOG `düzeltildi` diyorsa yeni bir devir belgesine
  "açık" olarak taşınmayacak.

### B19 + B21 — iptal geri bildirimi ve sahne klavyesi (28.10.2026)

**Kullanıcı seçimi (m00643):** backlog `planned` B19 + B21 paketi.

- **Keşif:** motor/API zaten hazırdı (`scan-service.cancel/pause/resume`,
  `POST /api/scan/:id/cancel|pause|resume`, `api.scanAction`). Eksik olan
  arayüzdü: `Disk.tsx` `case 'cancelled'` sessizce listeye dönüyordu,
  klavyede `P` yoktu, iptal tek tıktı. `Esc` hiçbir yerde taramayı
  iptal etmiyordu (korunacak davranış).
- **Motor:** yeni `src/core/scan-control.ts` (saf TS) — `ScanControl.phase`,
  `keyIntent`, `cancelNeedsConfirm`, `notice`; `Esc` daima `'none'`;
  `notice` tam eşleşme ile çalışır. `web/src/keyboard.ts` (`isTypingTarget`)
  tek kaynağa taşındı. 10 birim test.
- **Arayüz:** `div.banner[role="status"]` bilgi satırı (iptal/duraklat);
  hata bandından (`role="alert"`) ayrı; `P` ile duraklat/devam
  (`aria-keyshortcuts`); iptal iki adımlı (`Vazgeç` / `İptal et`).
- **Kapılar:** typecheck temiz, **500/500**, build yeşil
  (`index-FZKG0Nkp.js`, 140.37 kB gzip).
- **Tarayıcı (ego-browser, port 4425, 1500 klasör):** `P` duraklattı
  (ilerleme 6/1500'de dondu), tekrar `P` devam ettirdi; `Esc` taramayı
  durdurmadı; `İptal` → `Vazgeç`/`İptal et`; `Vazgeç` geri aldı;
  `İptal et` sonrası "Tarama iptal edildi · liste önceki taramadan"
  (danger bandı yok, 14 satır önceki taramadan). EN metni doğrulandı.
- **Commit:** `578cedd` (7 dosya, 222+/17-).
- **Ders:** ego turunda ekran varsayılanı Dashboard'dı; "Tara" düğmesi
  bulunamayınca ilk tur boş döndü. Ayrıca `/Tara/` deseni "Tarama güncel"
  rozetine de uyuyor — birincil düğmeyi `main button.primary` ile seçmek
  gerekir. Tarama sahnesi `Disk` açılışında otomatik başlayabilir; sahneyi
  bulduktan **hemen** `P` ile duraklatmak yarışı önler.

### T74/W2 — persona (28.10.2026)

- **Kapsam:** `docs/PROFILE-MODEL.md` üç ekseni ayrı tutar; bu turda yalnız
  **persona** uygulandı (developer / vibe coder / melez). Persona sunum
  seçer: açılış ekranı, rail sırası, yoğunluk, ilk açılış sorusu. Tarama
  kapsamı (`--profile`), risk, hedef, seçim, onay ifadesi ve `guard`
  değişmez.
- **Dört alt paket + bir temizlik:** W2-1 motor/sözleşme (`72e1218`),
  W2-2 sunum haritası + Ayarlar seçici (`9eb8b8b`), W2-3 onboarding
  (`052198c`), W2-4 adlandırma + yoğunluk (`10ac059`), kullanılmayan
  `ProfileView.panelModule` alanının kaldırılması (`c0a899d`).
- **Motor:** `src/core/profile.ts` — `USER_PROFILES`,
  `DEFAULT_USER_PROFILE='hybrid'`, `isUserProfile`, `normalizeUserProfile`;
  `contract.ts` `UserProfile` + `uiProfile`; `store/settings.ts` kalıcılık;
  `scan-service`/`server.ts` geçişi (geçersiz değer melez'e düşer).
- **Arayüz:** `web/src/profiles.ts` (`ProfileDensity`, `PROFILE_VIEWS`,
  `profileViewFor`), `App.tsx` `.app[data-density]` + rail grup içi sıra,
  `Settings.tsx` radio grubu + `onProfileChange`, `Onboarding.tsx` +
  `onboarding.ts` (`residue.onboarded`).
- **Kapılar:** src/web typecheck temiz, **500 → 526 test**, build yeşil
  (`index-BT4CEaS4.js`).
- **Tarayıcı (ego-browser, port 4426, izole `LOCALAPPDATA`/`TEMP`):**
  onboarding TR (üç kart, varsayılan melez, `Esc` → melez, odak `#main`),
  "Developer" → açılış Projeler + rail `Projeler, Graf, PATH & Ortam,
  Araçlar`; Ayarlar'dan "Vibe coder" + Kaydet → rail anında değişti, reload
  sonrası Genel Bakış ve onboarding tekrar **görünmedi**; EN metinleri
  ("What are you doing?", "Continue with this profile") doğrulandı; JS hatası
  yok. Yoğunluk: `compact` 36 px / `normal` 44 px satır, başlık dolgusu
  4 px / 6 px.
- **Kararlar:** (a) yoğunluk **`.app`** üzerinde — `documentElement`'te
  değil; (b) persona sağ panel modülü **seçmez**, karar ekran başına
  `panel-plan.ts`'te (dashboard'da `action` modülü yok) → boş alan silindi;
  (c) diyalogda `role="group"` + `aria-pressed` (kod tabanı deseni);
  (d) onboarding tetiklemesi `api.settings()` `try` bloğunun dışında.
- **Dersler:** (1) İşçi `tests/profile-naming.test.ts` dosyasını
  `Set-Content -Encoding UTF8` ile yazdı → **BOM + CRLF** (K13 tekrarı);
  orkestratör LF'e çevirdi, `\uXXXX` kaçışlarını gerçek karakterlere
  döndürdü. (2) Deterministik yoğunluk kanıtı için 5k fixture gerekmez:
  `.app` içine geçici `.cluster-row` enjekte edip `getComputedStyle`
  okumak aynı CSS kaskadını kanıtlar — izole sandbox taraması 0 küme üretti
  ve turu boşa çıkardı. (3) `page.screenshot` **mutlak** yol ister.
- **Açık:** PROFILE-06 (üç profilde gerçek `guard`/`report-only` koşusu) ve
  PROFILE-07 (ekran okuyucu + `prefers-reduced-motion` turu) elle/otomatik
  kanıt bekliyor; kapsam ölçümünün tazelenmesi sıradaki iş.

### Kapsam ölçümü tazeleme (28.10.2026)

`node --import tsx --test --experimental-test-coverage tests/*.test.ts` →
satır **%83.31** / dal **%76.08** / fonksiyon **%74.40** (526 test).

- Dosya kanıtı: `guard.ts` 100/87.5/100, `restore-target.ts` 100/100/100,
  `audit-export.ts` 100/94.3/100, `vault.ts` 87.9/70.8/71.7,
  `delete.ts` 61.2/68.5/34.4, `restore.ts` 32.9/100/25.
- **Karar:** hata yönetimi 55 → 60, toplam **77.75 → 78.50**. Yükseltme
  gerekçesi ölçülen dosyalardır (vault + restore-target + B23); 70'e
  çıkarılmadı çünkü hata enjeksiyonu ve `delete` döngüleri yok.
- **Bayat risk temizliği:** §7'deki "parity kısmi" (T79 ✅ 27.10),
  "performans/yük ölçümü yok" (W0-b-3 + T83 ✅) ve "T37/F5 açık" (ikisi de
  ✅ 23.10) maddeleri kaldırıldı; yerine `restore.ts` ölü yüzeyi ve backlog
  hijyeni riski eklendi.
- **Bulgu:** `state.json` backlog'unda B23 ve B24 `planned` kalmıştı, B22
  `done` ama `doneAt`/`commit` yoktu → üçü `done` + commit (`b5eb5d9`,
  `a8e7110`, `fd87707`) ile işaretlendi. (İlk turda B23'ün `bugs[]`
  kaydı yanlışlıkla güncellendi; `status: fixed` geri kondu — backlog ile
  aynı kimliği taşıyan iki kayıt var.)
- **Ders:** "kapsam ölçümü" tek başına ölçüm değil, **belge hijyeni** turudur:
  sayıyı yazarken gerekçe satırları ve risk listesi de kanıtla karşılaştırılır.
- **Flake (kayda geçti):** `main` üzerinde ilk `npm test` koşusunda
  `tests/scan-verify.test.ts` teardown'u `ENOTEMPTY ... rmdir
  residue-api-verify2-*\residue` ile düştü; ikinci koşu **526/526**. Aynı
  commit worktree'de de 526/526 geçmişti → ortam/yarış kaynaklı; risk
  listesine yazıldı, test zayıflatılmadı.

### B25 — status sayaç hatası (28.10.2026)

- **Belirti:** `residue status` "0 planli" diyordu; T64 `planned` idi.
- **Kök neden:** sayaç `status === 'todo'` arıyordu, `TaskState` tipi
  `planned` bilmiyordu; `renderHandoff` da aynı hatayı taşıyordu.
- **Düzeltme:** saf motor `src/core/task-view.ts` (`TaskViewList`) +
  `TaskStatus` genişletmesi; `status.ts` ve `state.ts` yalnız gösterir.
  Tanınmayan durum `counts.unknown` ile raporlanır (sessiz düşme yok).
- **Kanıt:** CLI çıktısı 1 planli + T64 satırı; `--export` T64'ü listeliyor;
  `tests/task-view.test.ts` 7 test; **533/533**; commit `f6a710b`.
- **Ders:** şema genişlemesi (yeni `status` değeri) **tek kaynak** tipini
  güncellemezse sayaç sessizce yanlış cevap verir. "0 planli" ile "plan yok"
  aynı şey değildir; tanınmayan değer görünür olmalı.

### T64/P2 + P3 + P9 — plan kaydı, menü rozeti, tarama geçmişi (28.10.2026)

- `docs/UX-PLAN-2026-10-21.md` kapsam denetimi (alt ajan + kod kanıtı): P5/P7/P8
  yapılmış; P1/P3/P4/P6 **kısmi**; P2/P9 **yok**. Sıra: P2 → P3 → P9 → P6 → P1 → P4.
- **P2a** işçi turu (Beam Free) + orkestratör düzeltmeleri: `ensureCacheLoaded`
  eksikliği (gerçek 400 hatası), `targetCount: 0` uydurma sabiti, ikinci sunucu
  açan testin süreci asması. Commit `02d8ffc` (8 dosya, 535+), test 544.
- **P2b** işçi turu: Dashboard **Planla**, Plan ekranında **Plan kayıtları**;
  başlık/hücre uyumu ve `as unknown as any` tip kaçamağı düzeltildi.
  Commit `674c4a7`, test 548, bundle `index-PyiYweXg.js`.
- **P3** işçi turu: `PlanBadge` motoru + rail rozeti + `aria-label`; boundary
  istisnası gerekçe yorumuyla eklendi. Commit `6a41dd6`, test 553.
- **P9a** işçi turu: `ScanHistory` motoru, `scans/index.json` deposu,
  `GET /api/scans`; kanca yalnız sistem taraması + `persistScan`. Commit
  `ee97d6d`, test 565.
- **P9b** işçi turu: Disk'te salt okunur geçmiş şeridi + `summary` alanı
  (shell-boundary korunur: arayüz moturu import etmez). Orkestratör
  `var(--font-mono)` → var olan `var(--mono)` düzeltmesi. Commit `6f1ac21`,
  test 566, build yeşil.
- Tarayıcı kanıtı (port 4427, izole env): Planla → kayıt satırı + `TASI` bloğu
  durumu, rozet 1 / "Planlar: 1 kayıt, 1 bekleyen", yeniden başlatmada kayıt
  kalıcı, geçmiş şeridi 3 satır TR/EN, JS hatası yok.
- **Ders:** (1) Dashboard "Güvenli kazanımlar" yalnız `risk === 'safe'` kümeleri
  listeler — orta riskli kümede `TASI` duvarı orada görünmez; testte bu yüzden
  safe küme kullanılır. (2) İzole sandbox'ta `scanOnLaunch` varsayılanı
  `always` olduğu için fixture taraması ezilir; fixture `settings.json`'a
  `scanOnLaunch: 'manual'` yazılmalı (geçerli değerler `always|daily|manual`).
  (3) `page.evaluate` içinde `localStorage` yalnız sayfa yüklendikten sonra
  erişilebilir (about:blank'te `SecurityError`).

### T64/P6 + P1 + P4 — UX PLAN kapandı (28.10.2026)

**Kapsam:** `docs/UX-PLAN-2026-10-21.md` P6 (sayı paydası), P1 (sağ panel modül
seçimi), P4 (arka planda ne çalışıyor). Üçü de dosya bazlı beyaz listeyle işçiye
verildi; kararlar ve düzeltmeler orkestratörde.

- **P6 `d61cdad`:** `dashboard-ratio` motoru (üç oran, `known` kapısı, 0..1
  kırpma). Orkestratör tarayıcıda **hero paydası hatasını** buldu
  (`used.denominator` = toplam disk, "kullanılan" diye etiketliydi) →
  `used.numerator`. Test 566 → 575.
- **P1 `f51ab41`:** `panel-prefs` motoru + `.rp-modules` menüsü +
  `localStorage`. **Tasarım hatası düzeltildi:** `sanitize` ekran listesine göre
  süzünce başka ekranda gizlenen modül sessizce unutuluyordu; artık `MODULE_IDS`
  sabit listesi var, eleme `resolve`'ta. Regresyon testi eklendi. 575 → 588.
- **P4 `45234e1`:** `background-view` motoru (6 satır, `tone` kuralları,
  `automatic:false` sabiti, `valueId`) + `BackgroundService` (salt okunur) +
  `GET /api/activity` + Ayarlar bloğu + Dashboard satırı. İşçi metinleri sabit
  Türkçe yazmıştı ve `as any` kullanmıştı → i18n anahtarlarına çevrildi,
  `ScheduleView.due/.missed` alanlarıyla tiplendi, 4/5 sn tazeleme eklendi.
  588 → 603.
- **Tarayıcı kanıtı:** TR/EN 6 satır; canlı tarama sırasında satır kendiliğinden
  "Disk taraması" oldu (host-taraflı poll), tarama bitince "Yok".
- **Ders:** (a) canlı durum tek seferlik okunmaz; (b) global tercih + ekran bazlı
  süzgeç = veri kaybı; (c) "busy görünmüyor" demeden önce iş yapan bir kök ver.

