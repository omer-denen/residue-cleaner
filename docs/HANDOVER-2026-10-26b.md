# Devir Kaydı — 26.10.2026 (b) · Orkestratör oturumu

> **Oturum türü:** orkestratör (görev bölme + kapılar + entegrasyon).
> **Dal / worktree:** `orkestrator` → `main` (fast-forward).
> **Sürüm:** `0.3.0-alpha.0` (yayınlanmadı). **Test:** 407 → **453/453**.
> **Gerçek silme yapılmadı**; kasa ve disk değişmedi.

---

## 1. Bu oturumda tamamlanan paketler

| # | Paket | Sonuç | Commit (main) |
|---|---|---|---|
| 1 | **B12 — durum şeması hijyeni** | `residue status` artık `[undefined] undefined` basmıyor; iki `bugs[]` şeması destekleniyor | `c909c9c`, `5487890` |
| 2 | **W0-b-1 — CLI-01…06 E2E** | gerçek `node bin/residue.mjs`, izole sandbox; 6 test | `010ef0d`, `5694969` |
| 3 | **B13 — kasa geri yükleme (kullanıcı hatası)** | `ENOTEMPTY/EPERM/EEXIST/ENOTDIR/EBUSY` yeniden deneme, hedef **asla ezilmez**, başarısız deneme audit'e yazılır, satır bazlı UI geri bildirimi | `6498134`, `7e8229f` |
| 4 | **B22 — denetim görünürlüğü** | `residue audit`, `GET /api/audit`, Kasa ekranında **Denetim** sekmesi; gerçek tarayıcıda TR/EN doğrulandı | `b5eb5d9`, `b89d250` |
| 5 | **W0-b-2 — PARITY-01…03** | süreç düzeyi CLI↔API eşitliği (+PARITY-01b kök taraması yalıtımı) | `f91627a`, `dffba17`, `b34e8d4` |
| 6 | **W0-b-3 — perf/yük bütçesi** | `npm run perf` + `scripts/perf-budget.json` + kaba regresyon kapısı | (bu commit) |

## 2. Kapı durumu (son)

- `npm run typecheck`: **temiz** (src + web).
- `npm test`: **453/453**, 0 fail (~5 sn). İki ardışık temiz koşu (parity + perf turlarında).
- `npm run build:web`: **yeşil**.
- `npm run perf`: **PERF TEMİZ** (177 sn; manuel/CI kapısı, `npm test` içinde değil).
- Gerçek tarayıcı: Kasa → Denetim sekmesi, TR/EN, satır verileri, kasa regresyonu doğrulandı
  (ego-browser space 6; ekran görüntüleri `scratch/audit-tr.png`, `scratch/audit-en.png`).

## 3. Ölçülen performans (taban / en kötü / bütçe)

| Ölçüm | Taban | En kötü gözlem | Bütçe |
|---|---:|---:|---:|
| PERF-01 tarama 10k dosya | 1856 ms / 30.4 MB | 2470 ms / 31.2 MB | 6000 ms / 90 MB |
| PERF-02 100 küme DiskView+JSON p95 | 1.82 ms | 4.12 ms | 12 ms |
| PERF-03 kasa taşıma | 4304 dosya/sn | 2704 dosya/sn | ≥ 1500 dosya/sn |
| LOAD-01 100k dosya | 8.7 sn / 22.4 MB | 19.9 sn / 30.6 MB | 45 sn / 90 MB |
| LOAD-04 10 eşzamanlı istek | p95 146 ms, 0 hata | p95 146 ms | 5xx = 0 |

> **Ders:** "ölçülen × 2" tek başına yetmiyor (100k taramada 2.3x sapma). Bütçe dosyası artık
> `measured` + `worstObserved` + `rationale` taşıyor; eşik uydurulmuyor, gerekçeleniyor.

## 4. Bu oturumda bulunan gerçek kusurlar

1. **B13 (kullanıcı raporu):** kasa geri yüklemede 1 öğe "Klasör dolu" hatası, 1 öğe sessizce
   yutuldu. Kök neden: `rename` çakışmasında yalnız `EXDEV/EPERM/EACCES` ele alınıyordu,
   `ENOTEMPTY/EEXIST/ENOTDIR` yeniden denenmiyordu; başarısız deneme **audit'e yazılmıyordu**;
   arayüzde tek `busy` bayrağı tüm satırları kilitliyordu. **Düzeltildi + 9 test.**
2. **B12:** `state.json` iki farklı `bugs[]` şeması taşıyordu; `status`/`status --export`
   ham alan okuduğu için `undefined` basıyordu. **Düzeltildi + 8 test** (`BugViewList`).
3. **Parity bulgusu (tasarım gereği):** `--root` taraması `/api/disk`'i **bilerek** güncellemiyor
   (T27/T10). Test bu yüzden env taraması üzerine kuruldu; kök yalıtımı ayrı test oldu.
4. **Test izolasyon sızıntısı:** `npm test` ortamındaki `npm_config_prefix` API tarafına
   sızıyor, CLI çocuk süreci temizlediği için parity kırılıyordu. Sandbox anahtar listesine eklendi.
5. **Eşik kalibrasyonu:** perf bütçesi ilk turda fazla sıkıydı (kapı kırdı) → taban + en kötü
   gözlem üzerinden yeniden kalibre edildi.

## 5. Açık işler (öncelik sırası)

| Kimlik | İş | Not |
|---|---|---|
| **T79** | PARITY-04 (graph) + PARITY-05 (project) | T78 altyapısı (tek sandbox + in-process API + `npm_config_*` izolasyonu) yeniden kullanılabilir |
| **LOAD-02 / LOAD-03** | 5k küme sanal liste, 1k SSE olayı | perf betiğine eklenebilir |
| **B23** | `rename` yarış sertleştirmesi | hedefte dosya oluşursa sessiz üzerine yazma penceresi |
| **B24** | Denetim ekranı: tarih/tür filtresi + CSV/JSON dışa aktarma | API zaten `since`/`kind` destekliyor |
| **T74 / W2** | web personası (developer / vibe / melez) | "önce altyapı" kuralı; altyapı büyük ölçüde kapandı |
| **UX-042** | alt kartların tıklanabilirliği | UX plan P maddeleri |
| **B19 / B21** | iptal geri bildirimi / tarama sahnesi klavyesi | web cila |

**Alpha kapısı:** CLI E2E ✅, PARITY-01…03 ✅, PERF-01…03 ✅, SEC-01…08 büyük ölçüde ✅.
Eksik: PARITY-04/05, LOAD-02/03 ve kapsam eşiği (satır ≥70 / dal ≥65 / fonksiyon ≥60).

## 6. Kullanıcıya ait açık kararlar

- Kasada **`Local\uv` (2.5 GB)** ve **`Local\rattler` (2.7 GB)** duruyor: geri alınacak mı,
  `SIL` ile kalıcı silinecek mi? (Yeni kod geri yüklemede hedefi ezmez, `.restored-<zaman>` adına çıkarır.)
- `docs/CLI-REMOVE-PLAN-REMOVAL.md` hâlâ git'te izlenmiyor (önceki oturumun uygulanmış planı) —
  commit edilsin mi, taslak mı kalsın?

## 7. Teknik notlar (sonraki oturum için)

- **Yeni komut:** `residue audit [--since 24h|7d|30d] [--kind delete|restore|purge|all] [--limit N] [--json]`
  → `audit.log` JSONL + journal'dan hedef yolları (salt okunur).
- **Yeni kapı:** `npm run perf` (≈3 dk) ve `scripts/perf-budget.json`; `npm test` içinde yalnız
  kaba 2000 dosya kapısı var.
- **Yeni motorlar:** `src/core/bug-view.ts` (`BugViewList`), `src/core/audit-view.ts` (`AuditView`),
  `src/core/restore-target.ts` (`RestoreTarget`). Hepsi saf TS (node builtin yok).
- **Yeni servis:** `src/services/audit-service.ts` (audit.log + journal okuma, limit 5000 satır / 200 yol).
- **Testler:** `tests/cli-e2e.test.ts`, `tests/parity-e2e.test.ts`, `tests/perf-budget.test.ts`,
  `tests/audit-view.test.ts`, `tests/audit-api.test.ts`, `tests/vault-restore.test.ts`,
  `tests/bug-view.test.ts`.
- **K15 hatırlatması:** web doğrulamasında önce eski sunucuyu kapat, `build:web` sonra sunucu.
  Bu oturumda doğrulama sonrası 4411 kapatıldı (0 dinleyici).
- **K13:** kaynak dosyaları PowerShell ile yazma; `edit`/`write` veya `node` + `fs`.
- **Orkestratör işçi modeli:** `opencode-go/beam-free`, ayrı görünür PowerShell penceresi,
  görev dosyaları `scratch/gorev-*.md`, loglar `scratch/logs/*.log` (hepsi gitignore'da).

## 8. Commit listesi (bu oturum, `main`)

```
c909c9c fix: durum semasi hijyeni - hata gorunumu motoru (B12)
5487890 docs: orkestrator kaydi - durum hijyeni (B12) + baseline
010ef0d test: CLI-01..06 uctan uca testleri (W0-b) - gercek surec, izole sandbox
5694969 docs: CLI E2E kaniti + readiness matrisi guncellemesi
6498134 fix: kasa restore saglamligi - ENOTEMPTY/EPERM yeniden deneme + basarisizlik denetimi (B13)
7e8229f fix(web): kasa satir bazli geri yukleme geri bildirimi (B13)
b5eb5d9 feat: denetim gecmisi gorunurlugu - residue audit + GET /api/audit + Kasa/Denetim sekmesi (B22)
b89d250 docs: B22 tarayici dogrulamasi (Denetim sekmesi, TR/EN, kasa regresyonu)
f91627a test: PARITY-01..03 surec duzeyi CLI<->API esitligi (W0-b-2)
dffba17 docs: parity kaniti + readiness matrisi (W0-b-2)
b34e8d4 docs: W0-b-2 parity kaydi (bulgular + izolasyon duzeltmesi)
+ perf commit (scripts/perf.mjs, perf-budget.json, tests/perf-budget.test.ts, package.json)
+ docs commit (bu devir kaydi + ORCHESTRATOR-LOG)
```

---

*Devir kaydı 26.10.2026 orkestratör oturumu sonunda yazıldı.*
