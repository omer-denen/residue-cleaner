# HANDOVER — 23.10.2026 · P4 kapandı (orkestratör oturumu)

**Sürüm:** `0.3.0-alpha.0` (npm'e yayınlanmadı)
**Orkestratör worktree:** `C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator`
**Dal:** `orkestrator` → `main` (fast-forward, `cc5bdc2`)
**İşçi model:** `opencode/glm-5.3-flash-free` (kullanıcı kararı)
**Protokol:** `ORKESTRATOR.md` · **Kayıt:** `docs/ORCHESTRATOR-LOG.md`

---

## 1. Özet

Bu oturumda **P4'ün kalanı** ve **T54** tamamlandı; P4 (T73) kapandı.
Her paket ayrı commit, ayrı diff denetimi ve ayrı kapıdan geçti.

| Paket | Commit | Kapsam | Test |
|---|---|---|---|
| E10a/b | `e95c50b` | Ölü `editor-workspace` kaldırıldı; 3b/7 tekrarı ve log-only `agent-workspace` temizlendi; adımlar 1..19 | +8 |
| E10c | `2c40f21` | `GPU_STATE` globali → `ClassifyOptions.gpu`; üçlü GPU durumu (`null` = bilinmiyor) | +8 |
| T54 | `893331c` | Eski ad kod + test + güncel belgelerden kaldırıldı | +4 |
| E11 | `06f8be2` | `LogSignal.kind` stabil kimlik; kararlar `means` metninden ayrıldı | +11 |
| C11 | `3efccbc` | Kaynakta ürün/uygulama adı temizliği + hijyen testi | +2 |

**Test:** 226 → **259/259** · `npm run typecheck` her adımda temiz.
**Ana repo doğrulaması:** merge sonrası `main` üzerinde typecheck + **259/259**.

---

## 2. Paket ayrıntıları

### E10a/b — mimari tip hijyeni

- `editor-workspace` hiç üretilmiyordu; tip birliğinden ve 7 tablodan
  kaldırıldı (`types`, `categories`, `evidence-text`, `merge`, `analyze`).
- `detectArchetype` adım 7'deki `skill-store`/`skill-lock` tekrarı ve
  yalnız-log dalı (`notebook|gunlendirme gunlugu|arka plan servisi`)
  kaldırıldı. Adım 16 artık yalnız `sessions/skills/memories/agents`
  marker'larıyla `agent-workspace` üretiyor.
- Adım numaraları tek sıraya (1..19) döküldü.
- **Davranış notu:** yalnız log taşıyan klasör artık `unknown`; iki karar da
  silme hedefi üretmez.

### E10c — GPU kanıtı parametre oldu

- `GPU_STATE` / `setGpuState` kaldırıldı. `ClassifyOptions.gpu` ile
  `classifyPath → detectSubParts/estimateReclaimable/decide` zincirine geçer.
- `detectGpu()` üçlü durum: kanıt / kesin yok (ENOENT) / **`null`**
  (erişim engellendi = bilinmiyor). `null` iken `gpuAbsent=false`.
- **Kapsam genişlemesi (orkestratör onayı):** imza değişikliği nedeniyle
  `doctor.ts` + iki mevcut testte zorunlu mekanik düzenleme; assertion
  silinmedi/zayıflatılmadı.

### T54 — eski adın kaldırılması (kullanıcı kararı)

- `LEGACY_DATA_DIR_NAME`, `legacyDataDir()`, `ownDataDirs()` eski yolları,
  `guard.ts` eski ad koruması kaldırıldı. Tek veri dizini
  `%LOCALAPPDATA%\residue` (ve `~/.residue`).
- `tests/legacy-name-removed.test.ts` geri gelişi engelliyor.
- **Disk:** `%LOCALAPPDATA%\clicleaner` ve eski repo klasörleri **yok**.
- **Kapsam:** tarihsel `docs/HANDOVER-*` ve `CHANGELOG` arşiv olarak korundu.
- **Güvenlik notu:** eski dizin artık "kendi veri" sayılmıyor. Başka bir
  makinede eski kasa varsa taranmadan önce elle taşınmalı.

### E11 — stabil log kimliği

- `LogSignal.kind?` (opsiyonel) + `LogSignalKind` birliği.
- `LOG_MARKERS` her girişte `kind` taşıyor; `means` yalnız gösterim.
- Kararlar `kind`e bağlı: `gpu-provider`, `model-catalog`, `npm-cache`,
  `nuget-cache`, `npmManaged`. `signalKind()` kind yoksa kanonik
  `means`ten eşler. `dedupeLogSignals` anahtarı `kind ?? means`.
- **Bilinçli sınır:** `cpuLine` ham log satırından okunmaya devam ediyor;
  `merge.ts` dedupe anahtarı değişmedi (nihai kanıt `analyze.ts` içinde
  kind ile tekilleşiyor).

### C11 — kaynak hijyeni

- Yorumlar/görünen metinler nötrleştirildi; `.vscode/tasks.json` sabiti
  yerine herhangi bir alt dizindeki `tasks.json` aranıyor (üst sınırlar
  `MAX_DIRS=40`, `MAX_CANDIDATES=120` aynı).
- `tests/source-hygiene.test.ts`: `src/**/*.ts` içinde 11 yasaklı adı
  `dosya:satır` ile raporlar; `Residue` serbest.
- `src/` içinde yasaklı ad **0 eşleşme**.

---

## 3. Bilinen riskler / sınırlar

1. **E11 geriye dönük eşleme:** `kind`siz eski kanıtlar kanonik `means`ten
   eşlenir. C11 bir `means` metnini nötrleştirdi; diskte kalıcı eski kanıt
   olmadığı için risk düşük.
2. **`cli-references` genel `tasks.json`:** arama kapsamı genişledi, üst
   sınırlar korundu; referans kontrolü gevşemedi.
3. **T54 güvenlik notu:** yukarıdaki eski kasa uyarısı.
4. **`scratch/` gitignore:** worktree'de yoksa `npm test` fixture hatası
   verir; oluşturulmalı.
5. **`AGENTS.md`, `state.json`, `SESSION_LOG.md`** gitignore'da — ana repoya
   elle kopyalanır.

---

## 4. Sıradaki iş

**Sıra (kullanıcı kararı, 23.10.2026):**

```
T69 kanıt hijyeni → T30 global AI artıkları → T37 yarım güncelleme artıkları
  → WEB: T74 3 profilli dinamik arayüz
```

- **T69:** `docs/EVIDENCE-AUDIT.md` + `docs/HANDOVER-2026-10-22.md`.
  F1 observer hijyeni, F2 durum log filtresi, F3 `usageVerdict`,
  F4 history parser, F5 UI kanıt turu. Dosya: `src/core/cli-inventory.ts`.
- **T30:** global AI runtime artıkları; model-store + log klasörü kanıtı.
- **T37:** yarım güncelleme artıkları (`.paket-rastgele`).
- **T74:** web 3 profil (developer / vibe coder / melez); profil yalnız
  sunum + varsayılan görünüm seçer; karar motoru ve güvenlik kapıları aynı.

---

## 5. Doğrulama komutları

```powershell
cd C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator
npm run typecheck
npm test                     # 259/259
git status --short           # temiz

cd C:\Users\Code\source\repos\residue-cleaner
npm run typecheck
npm test                     # 259/259 (merge sonrası)
```
