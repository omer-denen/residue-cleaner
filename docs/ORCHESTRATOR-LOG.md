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







