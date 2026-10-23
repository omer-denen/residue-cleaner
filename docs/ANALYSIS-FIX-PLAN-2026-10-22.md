# Kod Analizi Fix Planı — 22.10.2026

> **Kaynak:** `docs/residue-cleaner-analiz-ve-promptlar.md` (statik inceleme,
> E/C/W/D bulguları + 4 prompt). Bu belge o analizi **uygulama sırasına**
> bağlar, her bulgunun **kodda doğrulama durumunu** ve **kabul testini** yazar.
>
> **Kural:** Belge "tek prompt = tek commit" der. Her prompt sonunda
> `npm run typecheck` + `npm test` çalışır, commit atılır.

---

## 0. Oturum sırası (kullanıcı kararı, 22.10.2026)

| Sıra | Görev | Kapsam | Durum |
|---|---|---|---|
| 1 | **T70 / P1** | Yanlış silme riski: E1, E2, E3, E9, C1–C5 | ✅ 22.10.2026 (19 test) |
| 2 | **T71 / P3** | Keşif ve koruma: D6, D7, D8, D1–D5, D9 | ✅ 22.10.2026 (16 test) |
| 3 | **T72 / P2** | Ölçüm doğruluğu: W1–W6, E4, E8 | ✅ 22.10.2026 (9 test) |
| 4 | **T73 / P4** | Sağlamlık ve temizlik: C7–C10, E6, E7, E10, E11, C11 | ✅ 23.10.2026 (E10a/b, E10c, E11, C11 dahil) |

**T69 (kanıt hijyeni / CLI kullanım kanıtı) bu sıranın dışında kalır**, ayrı
kalem olarak durur: o iş `cli-inventory.ts` + `usageVerdict` ile ilgilidir,
bu plan `analyze.ts` / `classifier.ts` / `walker.ts` / `discover.ts` ile.
İkisi karıştırılmaz.

**Not:** Eski devir belgesindeki "F3 = sağ panel sürüklenebilir split" adı
bu planla çakışmasın diye burada **P1–P4** adlandırması kullanılır.

---

## 1. Doğrulama durumu (statik bulgu → kod)

Belge "önce doğrula" diyor. 22.10.2026 oturumunda P1 bulguları kodda
okunarak doğrulandı; diğerleri P3/P2/P4 başlarken doğrulanacak.

### P1 — Yanlış silme riski (DOĞRULANDI)

| # | Bulgu | Kod kanıtı | Sonuç |
|---|---|---|---|
| C1 | Log satırı tek başına `runtime-pool` yapıyor | `classifier.ts` `LOG_MARKERS`: `notebook calistirma ortami`, `arka plan servisi (named pipe)`; `analyze.ts` adım 4 log dalı | ✅ doğru |
| C2 | Her `onnxruntime*.dll` = `cuda-runtime` | `classifier.ts:155` `ORT_DLL_RE = /^onnxruntime[_-].*\.(dll\|so\|dylib)$/i` → `onnxruntime_providers_shared.dll`, `onnxruntime-genai.dll` da eşleşiyor | ✅ doğru |
| C3 | `models` dizin adı model-store kanıtı | `MODEL_MARKERS` içinde `models`; kökte ve `deepProbe`ta işaret | ✅ doğru |
| C4 | `chat-history` adı tek başına yeter | `classifier.ts:219-221` dört dizin adı; `:264` kök `chat*.json`; `analyze.ts` `buildSensitiveTargets` dördünü birden hedefliyor | ✅ doğru |
| C5 | CPU satırı GPU kanıtını veto ediyor (koşulsuz) | `analyze.ts` `detectSubParts`: `cpuOnly = /Device: CPU\|CPUExecutionProvider/` | ✅ doğru |
| C6 | 512 KB üzeri log tamamen atlanıyor, küçükte ilk 400 satır | `classifier.ts` `readLogFile` | ✅ doğru |
| E1 | `extensions.json` okunamazsa sürüm desenli her klasör artık | `analyze.ts` `detectEditorOrphans` + `readExtensionManifest` boş set döner | ✅ doğru |
| E2 | `model-store` kontrolü proje/ajan korumalarından önce | `analyze.ts:1025` (adım 2) vs 3b/4e | ✅ doğru |
| E3 | İç içe alt parça: CUDA dizini `-gpu` varyantının içindeyse ikisi de ekleniyor | `detectSubParts`: tek yönlü `variantDir.startsWith(o.path)` kontrolü; ters yön yok | ✅ doğru |
| E9 | Hassas hedef dizin başına kanıtlanmıyor | `buildSensitiveTargets` tek `chat-history` işaretiyle 4 dizin | ✅ doğru |

### Doğrulanacak (sırası gelince)

- **P3:** D1–D9 (özellikle D6/D7 ters yön kasa koruması, D8 kimlik klasörleri).
- **P2:** W1–W6 (W2 `bigint` iddiası gerçek makinede ölçülmeli), E4, E8.
- **P4:** C7–C11, E6, E7, E10, E11. ✅ 23.10.2026 doğrulandı —
  `scratch/p4-dogrulama.md` (C7–C11, E7, E10, E11 DOĞRU; E6 DOĞRU, E6b KISMEN).

---

## 2. P1 kabul testleri

Her satır bir birim testi (`tests/`) ile kanıtlanır.

| Test | Geçme koşulu |
|---|---|
| Log-only runtime | `logs` içinde yalnız `jupyter`/`kernel` satırı + başka yapısal kanıt yok → `runtime-pool` **değil** |
| Yapısal runtime | `envs/` veya `site-packages` var → `runtime-pool` (log olmasa da) |
| ORT sağlayıcı | `onnxruntime_providers_cuda.dll` → `cuda-runtime`; `onnxruntime_providers_shared.dll` ve `onnxruntime-genai.dll` → **değil** |
| Model adı | Sadece `models/` dizini (içinde model dosyası yok) → `model-store` **değil**; içinde `model.onnx` → `model-store` |
| Proje koruması | `package.json` + `node_modules` + `models/` → `project-workspace` (model-store değil) |
| CPU/GPU çelişkisi | Aynı logda `Device: CPU` ve `CUDAExecutionProvider` → `gpuUnusable` **false** (olumlu sinyal vetoyu kaldırır) |
| Büyük log | 512 KB üzeri log dosyasında **son** satırlardaki işaret kanıt olur (ilk satırlar değil) |
| Bozuk manifest | `extensions.json` bozuk + sürüm desenli klasör → hedef **yok**; `.obsolete` kaydı → hedef var |
| İç içe parça | `models/x-gpu/` içinde CUDA DLL'leri → tek parça (dış), bayt iki kez sayılmaz |
| Sohbet kanıtı | `sessions/` boş, `chats/*.jsonl` dolu → yalnız `chats` hedef; `sessions` hedef değil |

---

## 3. P1 uygulama sonucu (T70 — TAMAMLANDI, 22.10.2026)

**Commit kapsamı:** `src/core/classifier.ts`, `src/core/analyze.ts`,
`tests/classification-guards.test.ts` (**19 test**).

| # | Yapılan | Yer |
|---|---|---|
| C1 | Log dalı `runtime-pool` kanıtından çıkarıldı; yapısal kanıt (`envs`, `runtimed`, `pyvenv.cfg`, `site-packages`) zorunlu | `analyze.ts` adım 4 |
| C2 | `ORT_DLL_RE` yalnız `cuda` / `tensorrt` / `trt` sağlayıcılarını eşler | `classifier.ts` |
| C3 | `models` `MODEL_MARKERS`'tan çıktı; içerik `probeModelDir` ile aranır (2 seviye, sınırlı) | `classifier.ts` |
| C4 | Sohbet klasörü kanıtı dizin bazında: `probeChatDir` → `chat-dir:<ad>` işareti | `classifier.ts` |
| C5 | `logGpuVerdict()`: olumlu GPU sinyali `Device: CPU` vetosunu kaldırır (dışa açık, test edilebilir) | `analyze.ts` |
| C6 | Log okuma dosya sonundan: `LOG_TAIL_BYTES` 64 KB / `LOG_TAIL_LINES` 400; 512 KB atlama kaldırıldı | `classifier.ts` |
| E1 | `readExtensionManifest` → `{list, ok}`; manifest bozuksa yalnız `.obsolete` kanıt sayılır | `analyze.ts` |
| E2 | `model-store` koşulu `!projectManifest && !agentWorkspace` ile korunuyor | `analyze.ts` adım 2 |
| E3 | `dropNestedSubParts()` (dışa açık); `extra + detectSubParts` birleşiminde uygulanır | `analyze.ts` |
| E9 | `buildSensitiveTargets` yalnız `chat-dir:<ad>` işaretli dizinleri hedefler | `analyze.ts` |

**Doğrulama:** `npm run typecheck` temiz · `npm test` **142/142** (123 → 142,
+19) · yeni test dosyası `tests/classification-guards.test.ts`.

**Bilinçli sınır:** `probeModelDir` / `probeChatDir` ilk 2 seviyeye ve sınırlı
çocuk sayısına bakar (20–80). Daha derindeki model dosyası kanıt sayılmaz;
bu "güvenli tarafa düş" yönünde bir sınırdır (yanlış silme değil, eksik
tanıma).

---

## 4. P3 uygulama sonucu (T71 — TAMAMLANDI, 22.10.2026)

**Commit kapsamı:** `src/core/discover.ts`, `src/core/analyze.ts`,
`src/commands/scan.ts`, `src/actions/guard.ts`,
`tests/discovery-guards.test.ts` (**16 test**).

| # | Bulgu | Yapılan |
|---|---|---|
| D1 | `--env temp` tüm LocalAppData'yı tarıyordu | `temp` ve `vdisk` geniş AppData döngüsünden çıkarıldı; `temp` yalnız `%TEMP%` ekler |
| D2 | `lean` profilinde `exclude: ['Temp']` temp kökünü de eliyordu | `Temp` dislaması kaldırıldı; karar koda yorumla yazıldı |
| D3 | `PROTECTED_ROOTS` vdisk'i keşfetmiyordu | `findVirtualDiskDirs()`: yalnız `Packages\*\LocalState` ve `wsl\*` içinde `.vhd/.vhdx` olan klasör; `virtual-disk` → hedef yok |
| D5 | `audit` "hiçbir şey silme" vaadi kodda taşınmıyordu | `Profile.readOnly` + `ClassifyOptions.readOnly`; motor hedefleri sıfırlar (`report-only`) |
| D6 | `isOwnDataPath` normalize etmiyordu | `normalizeForCompare()`: eğik çizgi, `\\?\`, çift ayırıcı, `..`, `realpath` (junction/8.3), küçük harf, sınır kontrolü |
| D7 | Ters yön koruma yoktu | `filterProtectedTargets()` + `classifyPath` hedef süzgeci; not: "N korunan yol hedef alınmadı" |
| D8 | `.ssh/.gnupg/.aws/.azure/.kube` adaydı | `PROTECTED_DOT` + `isProtectedUserPath()`; keşif, `classifyPath` ve `guard.ts` üçünde de |
| D9 | `listDirs` her hatada `[]`; `stats.denied` hiç artmıyordu; junction sessiz | `listDirs` → `{names, denied, missing, links}`; `DiscoveryResult.warnings` + `skipped`; `scan.ts` uyarıları günlüğe yazar |
| D10 | Roaming döngüsünde kendi veri koruması yoktu | Eklendi |
| D11 | Ölü yardımcılar | `exists`, `sortTargets`, `ownerlessName` kaldırıldı |
| D12 | Veri dizini adı | Doğrulandı: `residue-cleaner` hiçbir sürümde veri dizini olmadı; ek yok |

**D4 (kapsam dışı bırakıldı, bilinçli):** `pkgcache` / `agent` / `runtime`
seçimleri hâlâ aynı aday kümesini (nokta klasörleri + AppData çocukları)
genişletir; ayrımı **sınıflandırma** yapar. Profil başına ayrı keşif kümesi
yazmak tarama kapsamını daraltıp mevcut sonuçları değiştirir; bu bir
tasarım işidir, güvenlik düzeltmesi değildir. `lean` garantisi artık
gerçekten "pkgcache + %TEMP%" olarak çalışır.

**Doğrulama:** `npm run typecheck` temiz · `npm test` **158/158** (142 → 158,
+16) · gerçek CLI: `--profile audit` çıktısında "Salt okunur profil" notu ve
0 hedef.

---

## 5. P2 uygulama sonucu (T72 — TAMAMLANDI, 22.10.2026)

**Commit kapsamı:** `src/core/walker.ts`, `src/core/analyze.ts`,
`src/core/types.ts`, `tests/walker-measurement.test.ts` (**9 test**).

| # | Bulgu | Yapılan |
|---|---|---|
| W1 | `largeFiles` ilk bulunan N'i tutuyordu | Gerçek "en büyük N": liste doluyken en küçük kayıt çıkarılır; sıra büyükten küçüğe |
| W2 | `stat` bigint değil; `BigInt(st.ino)` yuvarlanmış sayıdan | `stat(..., { bigint: true })`; anahtar `dev:ino` bigint olarak. **Gerçek ölçüm:** 2052 dizinde maks. ino 1.43e17 (> 2^53), 518'inde hassasiyet kaybı, **1 gerçek çakışma** → iddia doğrulandı |
| W3 | `onProgress` dosya döngüsünde (`dirs % 256 === 0`) | Zaman tabanlı kısıtlama (100 ms) + tur sonunda zorunlu bildirim |
| W4 | Hardlink'ler bayt olarak çok sayılıyordu | `nlink > 1` + `dev:ino` kümesi; tekrar baytları `hardlinkedBytes`'ta raporlanır |
| W5 | ENOENT dışı tüm hatalar `gone` | `reason: 'error'` + `code` (`EBUSY`, `EMFILE`, `EIO`...); `types.ts` güncellendi |
| W6 | Klasör içinde sıralı `stat` | 32'lik gruplarla sınırlı paralel `stat` (bellek sınırı korunur) |
| E4 | `os-user-data`/`unknown` default dalı pozitif tahmin üretiyordu; `temp`/`runtime` tamamı | `estimateReclaimable`: `temp` → 3 gün, `runtime` → 90 gün kırılımı; `os-user-data`/`unknown`/`electron` → 0. `classifyPath` sonunda `reclaimableBytes = hedef toplamı` (git/koruma süzgecinden sonra) |
| E8 | Aynı dizin birden çok kez yürünüyordu | `MeasureCache` (yol → tek promise); alt parça/uzantı/sürüm ölçümleri paylaşır |

**Doğrulama:** `npm run typecheck` temiz · `npm test` **167/167** (158 → 167,
+9) · gerçek ölçüm: repo `node_modules` 7615 dosya / 82.226.567 bayt,
PowerShell toplamıyla **birebir aynı**, 139 ms.

**Sınır:** OneDrive yer tutucuları için "tahsis edilen boyut" okunmuyor
(README'de vaat edilmiyor); yalnızca hardlink düzeltmesi yapıldı.

---

## 5b. P4 uygulama sonucu (T73 — TAMAMLANDI, 23.10.2026)

Orkestratör oturumu; her paket ayrı commit + ayrı kapı. İşçi model:
`opencode/glm-5.3-flash-free`.

| Paket | Commit | Yapılan | Test |
|---|---|---|---|
| C7 | `1ef0998` | `probeLogs` sağlamlığı (yedek dal, önek, log dizini) | +7 |
| C8 | `1f4b202` | Python ortam kanıtları (`pyvenv.cfg`, `venv`, `Scripts`) | +8 |
| C8b | `6478828` | `runtime-pool` proje korumasından önce gelmesin | +7 |
| C9 | `af229dc` | SDK kombinasyon kanıtı + ölü `hasSdkMarker` | +9 |
| C10 | `776946f` | `deepProbe` determinizmi + benzersiz tür eşiği | +4 |
| E7 | `f6219cd` | Yol sınırı (`Temp2`, `Local2`, `UserProfile2`) | +8 |
| E6 | `0bb2aac` | Sınır görünürlüğü + semver ön sürüm + güncel kanıtı | +11 |
| E10d | `d5587ee` | `SystemRoot` / GPU algılama sabit yolu | +5 |
| **E10a/b** | `e95c50b` | Ölü `editor-workspace` kaldırıldı; 3b/7 tekrarı ve log-only `agent-workspace` temizlendi; adımlar 1..19 | +8 |
| **E10c** | `2c40f21` | `GPU_STATE` globali → `ClassifyOptions.gpu`; üçlü GPU durumu (`null` = bilinmiyor) | +8 |
| **E11** | `06f8be2` | `LogSignal.kind` stabil kimlik; kararlar `means` metninden ayrıldı | +11 |
| **C11** | `3efccbc` | Kaynakta ürün/uygulama adı temizliği + `tests/source-hygiene.test.ts` | +2 |

**Toplam:** 167 → **259/259**; typecheck her adımda temiz.
**Bilinçli sınırlar:** `cpuLine` ham log satırından okunmaya devam ediyor
(E11 kapsamı `means` bağımlılığı); `merge.ts` dedupe anahtarı değişmedi,
nihai kanıt `analyze.ts` içinde `kind` ile tekilleşiyor; eski `clicleaner`
veri dizini artık "kendi veri" sayılmıyor (T54 kullanıcı kararı, diskte
dizin yok).
**Kapsam genişlemesi (orkestratör onayı):** E10c'de işçi 3 dosyada
(`doctor.ts` + iki mevcut test) `detectGpu` imza değişikliği için zorunlu
mekanik düzenleme yaptı; assertion silinmedi/zayıflatılmadı.

---

## 6. Uygulama notları

- **Motor kuralı:** `classifier.ts` + `analyze.ts` saf kanıt katmanıdır;
  `src/core/` dışına bağımlılık eklenmez.
- **AGENTS kural 13:** genel ad (`models`, `sessions`, `cache`) tek başına
  kanıt değildir; içerik kanıtı aranır.
- **AGENTS kural 9:** proje içi taramalar rapor modunda kalır; P1/P3/P2
  değişiklikleri bu kapıyı gevşetmez.
- **Belirsizlik:** dosya adı/kalıp doğrulanamıyorsa güvenli tarafa düş
  (`ask` / `report-only`).

---

## 7. Devir

- Bu belge güncellenir: her prompt bitiminde durum sütunu ve "doğrulama"
  tablosu işlenir.
- `state.json`: T70 (P1, done), T71 (P3, done), T72 (P2, done),
  **T73 (P4, done 23.10.2026)**, **T74 (3 profilli web, planned)**.
  `SESSION_LOG.md` + `docs/HANDOVER-2026-10-23.md`: oturum özeti.
- **P4 tamamlandı.** Sıradaki: **T69** (kanıt hijyeni) → **T30**
  (global AI artıkları) → **T37** (yarım güncelleme artıkları) →
  **web (T74, 3 profil)**. Kullanıcı kararı 23.10.2026: önce tüm kritik
  altyapı, web en son.
- **P4 başlarken:** C7–C11, E6, E7, E10, E11 maddelerini önce kodda
  doğrula; özellikle E10'da `GPU_STATE` globalini `ClassifyOptions`'a
  taşımak imzaları değiştirir (web/server çağrıları kontrol edilmeli).
