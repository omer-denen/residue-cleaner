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
