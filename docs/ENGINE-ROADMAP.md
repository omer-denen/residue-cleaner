# Residue — Motor ve Modül Durumu

> Bu belge, kullanıcının verdiği "Motor ve Modül Raporu" ile mevcut kodun
> eşlemesini tutar. Amaç mimariyi sıfırdan değiştirmek değil, **mevcut
> yapının üzerine** eksik motorları eklemektir.
>
> Son güncelleme: 21.10.2026 · sürüm: 2.1.0 (geliştirme)

## 1. Özet durum

| # | Rapor bölümü | Durum | Nerede |
|---|---|---|---|
| 2 | Keşif | Mevcut + genişletildi | `src/core/discover.ts`, `cli-inventory.ts`, `node-runtimes.ts` |
| 3 | Tarama | Mevcut + iyileştirildi | `walker.ts`, `commands/scan.ts`, `services/scan-service.ts` |
| 4 | Kanıt toplama | Yeni yapı eklendi | `core/evidence-tree.ts` + mevcut `classifier.ts` |
| 5 | Analiz / sınıflandırma | Genişletildi | `analyze.ts`, `categories.ts`, `owner-status.ts` |
| 6 | Bağımlılık grafı | **Yeni** | `core/dependency-graph.ts` |
| 7 | Ortam değişkeni | **Yeni** | `core/env-engine.ts` |
| 8 | Proje bağımlılıkları | **Yeni** | `core/project-deps.ts` |
| 9 | Plan / zamanlama | **Yeni** | `core/plan-engine.ts`, `services/schedule-service.ts` |
| 10 | Kasa | Mevcut + genişletildi | `actions/vault.ts` |
| 11 | Silme / geri yükleme | Mevcut + sertleştirildi | `actions/delete.ts`, `vault.ts`, `services/delete-service.ts` |
| 12 | Hata / kurtarma | Kısmen yeni | `core/app-error.ts`, `core/operation-journal.ts` |
| 13 | Sunucu / güvenlik | Mevcut + yeni uçlar | `web/server.ts` |
| 14 | Arayüz | **Yok** (2.0.0'da kaldırıldı) | T44 / `docs/WEB-REBUILD-PLAN.md` |
| 15 | Depolama / ayarlar | Genişletildi | `store/settings.ts`, `store/schedules.ts`, `store/scan-cache.ts` |

## 2. Bu oturumda eklenen / sertleştirilen motorlar

### Kanıt ağacı — `src/core/evidence-tree.ts`
- `Tool → Candidate → Claim → Evidence → Observation` zinciri.
- Her gözlem `source+key+value` ile tekilleştirilir ve `obsId` alır.
- Kanıt duruşu: `supports | protects | unknown`.
- `Cluster.evidenceTree` alanına `classifyPath` sırasında bağlanır.
- Tek zayıf sinyal (ör. yalnız mtime) `unknown` ağırlığındadır.

### Bağımlılık grafı — `src/core/dependency-graph.ts`
- Düğüm türleri: tool, package, shim, path-entry, env-var, project,
  state-dir, shortcut, runtime, process, config.
- Kenar türleri: exec, package, project-ref, env, runtime, shortcut,
  link, config; güç: hard/soft/weak; durum: intact/broken/shadowed/
  drifted/missing-chain/cyclic/unknown.
- Roller: isolated/leaf/shared/hub; seviye: low/medium/high/critical.
- Tarjan SCC ile döngü; kopuklukları **kök nedene** göre gruplama.
- `whatIf()`: seçim birlikte değerlendirilir; aynı kurulum grubundaki
  shim/paket kenarları engel sayılmaz; sert+aktif dış bağımlılık engeller.
- `buildInventoryGraph()` CLI envanteri + PATH gölgelerinden graf kurar.
- CLI kaldırma planı artık grafiği kullanır; engellenen araçlar
  `CliPlanResponse.blocked` içinde döner.

### Ortam değişkeni — `src/core/env-engine.ts`
- HKCU/HKLM ayrı okunur; `REG_EXPAND_SZ` korunur.
- PATH: eksik dizin, tekrar, gölgelenen komut, User/Machine çakışması.
- Yetim `*_HOME` / `*_ROOT` / `*_PATH` değişkenleri.
- Hassas isimler (`*_TOKEN`, `*_KEY`, `*_SECRET`…) maskelenir; API
  görünümünde ham değer **hiç dönmez** (`redactEnvironmentAnalysis`).
- Temizlik **plan → yedek → yaz → WM_SETTINGCHANGE** sırasıyla.
- `setx` kullanılmaz (1024 karakter kesmesi).
- HKLM değişikliği yönetici hakkı ister; yoksa yalnız öneri kalır.
- `residue env --clean --apply` yazılı `TEMIZLE` onayı ister.

### Proje bağımlılıkları — `src/core/project-deps.ts`
- Ekosistem: npm/pnpm/yarn/bun, Python (pip/uv/poetry/pipenv),
  .NET, Rust.
- Monorepo: `workspaces`, `pnpm-workspace.yaml`, turbo/nx/lerna.
- Yeniden üretilebilirlik: lockfile + hash, git izleme, patch, yerel
  bağımlılık, runtime kurulu mu, yakın kullanım, çalışan süreç.
- Tarif (recipe): ekosistem, yollar, lockfile hash, runtime, kurulum ve
  doğrulama komutu; kimlik bilgisi saklanmaz.
- Donmuş lockfile komutları: `npm ci`, `pnpm install --frozen-lockfile`,
  `yarn install --immutable`, `bun install --frozen-lockfile`, `uv sync --frozen`.
- pnpm hardlink etkisi için gerçekçi kazanç tahmini (~%10).
- `restoreProjects()` sınırlı eşzamanlılıkla yeniden kurar ve doğrular.

### Plan / zamanlama — `src/core/plan-engine.ts`
- Kural **sabit liste değil seçici** saklar: kategori, risk, idle gün,
  anahtar, maksimum öğe.
- Günlük/haftalık/tek sefer; kaçırılan çalışma sayısı.
- Zamanlanmış işlem **yalnızca kasaya taşır**; `purge` ve env otomatik yok.
- Sunucu kapalıyken çalışmaz; açılışta `catchUp()` öneri üretir.
- `plan-run.lock` ile aynı anda tek çalışma.

### Kasa / yürütme — `src/actions/vault.ts`, `delete-service.ts`
- Yeni öğeler: `items/<id>/payload` + `meta.json`; manifest atomik
  (`tmp + rename`); `index.json` ve manifestlerden yeniden oluşturma.
- Kararlı `id`: eski `batch:index` kimliği kaymıyordu; artık
  `entry.id` (eski kayıtlarda `storedPath`'ten türetilir).
- Çakışma politikası: `rename` (varsayılan), `overwrite` (mevcut hedef
  `.replaced-*` olarak yedeklenir), `cancel`.
- Geri yükleme sonrası dosya sayısı/boyut doğrulaması.
- `purgeVaultItems(ids)`: yalnız seçili öğeler; yol kabul etmez.
- Eski `purgeVault()` artık yalnız `b-*` ve geçerli manifestli partileri
  siler; CLI yedek/karantina klasörlerini **korur**.
- `OperationJournal`: JSONL, `pending → in-progress → done/failed/skipped`;
  açılışta yarım kalanlar `residue recover` ile raporlanır.
- Devre kesici: art arda 5 hata veya %20 hata oranı.
- Reparse-point ata zinciri kontrolü: junction/symlink üzerinden başka
  dizine giden hedefler silinmez.
- Denetim kaydı: yüksek risk onayı, silme sonucu, kasa purge/restore
  olayları `%LOCALAPPDATA%\residue\audit.log` (JSONL) dosyasına yazılır.
- SSE kalp atışı: uzun süren işlemlerde bağlantı boş kalmaz.

### Tarama iyileştirmeleri
- Erişilemeyen yollar artık `ScanResult.skipped` ve SSE `skipped`
  olayına akar; `denied`/`long-path` sayaçları gerçek.
- Hedef içi canlı ilerleme (`walk` → SSE `progress`).
- Duraklat/devam (`/api/scan/:id/pause|resume`) — hedef sınırında.
- `--root` modunda dışlama listesi uygulanır.
- Tarama önbelleği sürümlü zarf + atomik yazım; eski biçim okunur.
- `DefaultSelection` artık yalnızca `risk=safe` öğeleri varsayılan seçer.

### Hata modeli — `src/core/app-error.ts`
- `transient | permission | conflict | missing | no-space | integrity |
  cancelled | validation | fatal`.
- `toBody()`: type/title/detail/operationId/itemId/retryable/dataSafe.
- API hata gövdesi geriye uyumlu `error` alanına ek olarak bu alanları taşır.
- `shouldRetry()` yalnızca geçici hatalarda ve en fazla 3 denemede true.

## 3. Bilinçli olarak korunan mevcut davranışlar

- **Windows Geri Dönüşüm Kutusu kullanılmaz**; kasa kullanılır.
- **Tek veri dizini: `%LOCALAPPDATA%\residue`.**
- **`clean --purge`** geriye uyumluluk için hâlâ var (aşağıdaki çelişki).
- **Web arayüzü yok**; `residue api` yalnız HTTP/SSE API sunar.
- **Windows Görev Zamanlayıcı yok**; planlar yalnız süreç açıkken çalışır.

## 4. Çelişkiler / açık kararlar

1. **"Kalıcı silme yalnız kasadan" vs mevcut `clean --purge`.**
   Mevcut `--purge` ve `POST /api/plan {mode:'purge'}` taranan yolu doğrudan
   siler. Geriye uyumluluk için kaldırılmadı; öneri: 3.0'da `purge`
   yalnızca `vaultItemId` ile çalışsın, doğrudan yol modu kaldırılsın.
2. **Kasa yerleşimi.** Rapor `vault/items/<id>/{payload,meta.json}` diyor;
   mevcut partiler `vault/<batch>/items/...` altında. Yeni öğeler
   `vault/<batch>/items/<id>/payload` + `meta.json` olarak yazılır; eski
   partiler bozulmadan okunur. Global `vault/items` düzenine geçiş
   veri taşıma gerektirir.
3. **React/Vite arayüzü.** 2.0.0'da kaldırıldı; bu oturumda geri
   getirilmedi. Motorlar API/CLI üzerinden kullanılabilir; UI T44.
4. **Ortam değişkeni yazımı.** Eski README "PATH/kayıt defterine dokunmaz"
   diyordu. Yeni motor bunu **yalnız açık `env --clean --apply` + yedek +
   yazılı onay** ile yapar. README güncellendi.
5. **Plan motoru kapsamı.** Kural tabanlı kasa taşıma hazır; "konsolidasyon"
   ve "env düzenleme" eylem türleri henüz plana bağlanmadı.
6. **Worker threads.** Async sınırlı eşzamanlılık var; CPU işleri hâlâ ana
   thread'de. Ölçümde darboğaz olursa worker'a taşınmalı.
7. **Tembel boyut / mtime önbelleği.** Tüm hedef boyutları hâlâ taranır;
   yalnızca 24 saatlik tam sonuç önbelleği var. Yol+mtime bazlı kısmi
   önbellek bir sonraki adım.
8. **Graf kapsamı.** CLI/PATH grafiği tam; disk kümeleri ve proje
   bağımlılıkları grafa henüz tam bağlanmadı.
9. **Yüksek risk override denetimi.** CLI kaldırma engeli var; "ad yaz +
   onay kutusu + override audit" akışı henüz yok.
10. **Model ağırlıkları.** Varsayılan taramada model depoları korunur;
    "ayarlardan aç" anahtarı henüz eklenmedi.
11. **Paket yöneticisi kurulum kökleri.** winget/scoop/choco/pipx shim'leri
    CLI envanterinde **salt okunur** listelenir; disk taramasında silme
    adayı yapılmaz (kurulu araç yanlışlıkla "artık" sayılmasın).
12. **Test sayısı.** `npm test` 56 test çalıştırır; tarama/SSE için uçtan
    uca testler hâlâ sınırlı.

## 5. Önerilen sıradaki adımlar

1. Web arayüzü T44: yeni motorları (env/project/graph/schedule/vault)
   ekranlara bağla; sanal liste + SSE.
2. `purge` yol modunu kaldır; kasa öğe kimliği zorunlu hale getir.
3. Disk kümelerini ve proje artifact'larını bağımlılık grafına bağla.
4. Yol+mtime bazlı boyut önbelleği ve worker thread'ler.
5. Yüksek risk override + denetim kaydı.
6. Plan motoruna konsolidasyon ve env düzenleme eylemleri.
