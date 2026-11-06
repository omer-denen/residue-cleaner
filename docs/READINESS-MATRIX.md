# READINESS MATRIX — 0.3.x (T74 / W0-a)

> **Durum:** guncellendi 06.11.2026; 745 test; kapsam satir **%86.29** / dal **%80.15** / fonksiyon **%80.32** (03.11.2026 olcumu); agirlikli skor **85.00**.
> **Kapsam:** alpha/beta kapıları + E2E senaryo kataloğu (CLI, SAFE, ERR,
> SEC, API, PARITY, SCHED, ENV, PERF, LOAD, WEB, PROFILE).
> **Kaynak kararlar:** `docs/HANDOVER-2026-10-23c.md` §4, `AGENTS.md`,
> `docs/PROFILE-MODEL.md`.
> **Kural:** Bu belge bir *kanıt* belgesidir. Test edilmemiş davranış
> "hazır" sayılmaz; seviye yükseltmek için kanıt satırı eklenir.

---
> **Not (28.10.2026, T64/P2-P3-P9):** Plan akışı artık **tarihli kayıt** bırakır
> (`plans.json`, motor `src/core/plan-records.ts`) ve menüde **Planlar rozeti**
> vardır (`src/core/plan-badge.ts`). Her sistem taraması `scans/index.json`'a
> **özet** kayıt yazar ve Disk ekranında salt okunur **Tarama geçmişi** şeridi
> gösterir (`GET /api/scans`). Test **566**. UX PLAN P2/P3/P9 ✅; P6/P1/P4 açık.
> Bu not **puanı değiştirmedi** (78.50; alfa ✅, beta 85 ✗).
>
> **Not (28.10.2026, T64/P6 + P1 + P4 — T64 kapandı):** Dashboard sayıları payda
> ve oran taşır (`src/core/dashboard-ratio.ts`; payda bilinmezse eski metin).
> Sağ panelde kullanıcı modül seçimi vardır (`src/core/panel-prefs.ts`,
> `residue.panel.hidden`; sıra ekran planından, son modül korunur). Arka plan
> durumu salt okunur özetlenir (`src/core/background-view.ts`,
> `GET /api/activity`; `automatic:false` sabiti). Test **603**. UX PLAN P1–P9 ✅.
> Bu not **puanı değiştirmedi** (78.50; alfa ✅, beta 85 ✗).

---

## 1. Seviye ölçeği

| Seviye | Ad | Kanıt koşulu |
|---:|---|---|
| **L0** | Yok | Kod veya ölçüm yok |
| **L1** | Uygulandı | Kod var; otomatik test yok |
| **L2** | Birim | En az bir birim testi; hata yolu sınırlı |
| **L3** | Entegrasyon | Servis/API düzeyinde test; gerçek uç yok |
| **L4** | Uçtan uca | Gerçek CLI veya gerçek tarayıcı ile tekrarlanabilir kanıt |
| **L5** | Düşmanca | Hata enjeksiyonu, yük, güvenlik saldırısı, sınır koşulu |

`—` = o boyut sınıf için uygulanamaz (ör. karar motorunda "SEC").

---

## 2. Agirliklar ve mevcut skor

| Boyut | Agirlik | Alt skor | Katki | Gerekce |
|---|---:|---:|---:|---|
| Islevsel dogruluk | 25 | 85 | 21.25 | Motor + API genis; CLI E2E ve PARITY-01..05 tamam; web E2E manuel (ego) |
| Guvenlik degismezleri | 25 | 90 | 22.50 | guard/onay/vault guclu; Git tracked + junction silme korumasi artik otomatik (`tests/safety-fs.test.ts`) |
| Hata yonetimi | 15 | 80 | 12.00 | `delete.ts` hata enjeksiyonu (10 test), plan TTL (2), bozuk JSON + 1 MB govde + 404 (API) otomatik |
| Guvenlik (HTTP/kapilar) | 15 | 85 | 12.75 | Origin, loopback adresi, govde siniri ve token testleri otomatik; smoke 34 kontrol |
| Gozlemlenebilirlik | 10 | 80 | 8.00 | Gunluk + journal + `log --summary`; metrik yok |
| Performans | 5 | 85 | 4.25 | PERF-01..03 olculdu, `scripts/perf-budget.json` kapisi var |
| Yuk | 5 | 85 | 4.25 | LOAD-01..04 olculdu, butce esikleri tanimli |
| **Toplam** | **100** | | **85.00** | |

**Kapilar:** alpha **>= 70**, beta **>= 85**. Agirlikli puan kapisi **03.11.2026 itibariyla 85.00**.

Kapsam (729 test): satir **%86.29**, dal **%80.15**, fonksiyon **%80.32**; beta kapsam kosulu (satir >= 85, dal >= 80, fonksiyon >= 75) saglandi.

> **Not (05.11.2026):** Asagidaki eski notlar tarihsel kayittir. Guncel kanit
> icin bolum 8'e bakin. PROFILE-06, WEB-15/17 ve reduced motion dogrulandi;
> PROFILE-07 ekran okuyucu turu hala elle yapilir.

---

## 3. Sınıf × boyut

| Sınıf | F | SAFE | ERR | SEC | PERF | LOAD | OBS | Kanıt / not |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Karar motoru (`classifier`, `analyze`, `merge`, `selection`) | 3 | 4 | 2 | 3 | 0 | 0 | 3 | 40+ fixture testi; gerçek disk E2E otomatik değil |
| `walker` / ölçüm | 4 | 4 | 3 | 3 | 2 | 0 | 2 | 139 ms / 7.6k dosya mikro ölçümü; tam tarama perf yok |
| `guard` / `approval` | 4 | 5 | 2 | 4 | 0 | 0 | 3 | Düşmanca guard testleri; `--yes` bypass testi var |
| `vault` / `delete` | 3 | 4 | 1 | 3 | 0 | 0 | 3 | 28.10.2026: `vault.ts` %87.9 satır / %71.7 fonksiyon, `delete.ts` %61.2 / %34.4 (döngüler test dışı), `restore-target.ts` %100; hata enjeksiyonu yok |
| Servisler (`scan/delete/cli/env/project/graph/schedule`) | 3 | 4 | 2 | 3 | 0 | 0 | 2 | API testleri + motor testleri; yük yok |
| `store` (cache/settings/schedules) | 3 | 3 | 2 | 3 | 0 | 0 | 2 | Atomik yazma; bozuk JSON testi var |
| HTTP adaptörü (`server.ts` / `http.ts`) | 3 | 4 | 2 | 4 | 0 | 0 | 2 | 401/403 + 34 smoke; Origin/gövde sınırı E2E değil |
| CLI komutları | 2 | 4 | 2 | — | 0 | 0 | 2 | `npm test` içinde gerçek CLI E2E yok |
| Web UI (React) | 2 | — | 1 | — | 0 | 0 | 1 | M5 elle doğrulandı; otomatik tarayıcı E2E yok |
| Kullanıcı profilleri (T74) | 3 | 3 | 1 | 3 | 0 | 0 | 3 | Persona yalnız sunum: kalıcılık + API sözleşmesi + `/api/disk`/plan değişmezliği test edildi (26 test); ekran okuyucu turu yok |

---

## 4. Alpha / beta kapıları

### Alpha (0.3.x yayın adayı)

1. `npm run typecheck` + `npm test` + `npm run smoke` yeşil; 0 fail.
2. **SAFE-01…11** ✅; açık P0/P1 yok.
3. **CLI-01…06** otomatik E2E (gerçek `node bin/residue.mjs`). ✅ 26.10.2026
   (`tests/cli-e2e.test.ts`, 6 test)
4. **PARITY-01…05** otomatik (CLI JSON ↔ API JSON normalize eşitlik). ✅
   01–03 26.10.2026 (`tests/parity-e2e.test.ts`); 04–05 27.10.2026
   (`tests/parity-t79.test.ts`, commit `16f29db`)
5. **PERF-01…03** ilk ölçüm + yazılı eşik (p95, RSS). ✅ 26.10.2026
   (`scripts/perf.mjs` + `scripts/perf-budget.json`; `npm run perf` kapı)
6. **SEC-01…08** yeşil (401, 403 Host/Origin, çerez, gövde sınırı).
7. Kapsam: satır **≥ 70**, dal **≥ 65**, fonksiyon **≥ 60**
   (mevcut 79.93 / 74.87 / 67.27 → satır+dallar geçer, fonksiyon geçer).
8. Bilinen sınırlar `README` + bu belgede yazılı.

**Alpha durumu:** ✅ — 27.10.2026. Tüm alpha maddeleri kapandı (CLI E2E, PARITY-01…05,
PERF-01…03, SEC-01…08, skor 76.50 ≥ 70). Kapsam eşikleri en son 23.10.2026 ölçümüne
dayaniyor (79.93 / 74.87 / 67.27); yeni testlerden sonra **tazelenmeli**.
Kalan açıklar beta maddeleridir: web E2E, PROFIL.

### Beta (yayın öncesi)

1. Tüm alpha maddeleri.
2. Kapsam: satır **≥ 85**, dal **≥ 80**, fonksiyon **≥ 75**.
3. **WEB-01…18** + **PROFILE-01…07** gerçek tarayıcıda (ego-browser) ✅.
4. **ERR-01…08** + `delete`/`vault` hata enjeksiyonu.
5. **LOAD-01…04** ölçüldü; p95/RSS/eşzamanlılık eşikleri yazılı. ✅ 28.10.2026
   (`scripts/perf.mjs` LOAD-02/03 + `scripts/perf-budget.json`)
6. Üç profilde aynı veri/sayı/hedef/onay ifadesi; profil değişimi tarama
   tetiklemiyor.
7. Klavye-only tur + ekran okuyucu + `prefers-reduced-motion` üç profilde.

**Beta durumu:** ❌ — web E2E ve yük ölçümü yok.

---


## 5. E2E senaryo kataloğu

Durum: ✅ otomatik · 🟡 kısmi/elle · ❌ yok.

### 5.1 CLI

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| CLI-01 | `scan --json` (fixture kök) | Geçerli JSON; küme/karar alanları; yazma yok | ✅ |
| CLI-02 | `clean --dry-run` | Plan basılır; 0 silme; 0 kasa taşıma | ✅ |
| CLI-03 | `inventory --json` | Araç + kanıt + güven; salt okunur | ✅ |
| CLI-04 | `repair --dry-run` | Plan; `ONAR` olmadan uygulama yok | ✅ |
| CLI-05 | `quarantine <ad> --dry-run` | `KARANTINA` olmadan taşıma yok | ✅ |
| CLI-06 | `status` / `log --summary` | Sayımlar tutarlı; hata yok | ✅ |

> **CLI-01…06 otomatik E2E (26.10.2026):** `tests/cli-e2e.test.ts` — gerçek
> `node bin/residue.mjs` süreci, izole sandbox (`LOCALAPPDATA`, `APPDATA`,
> `USERPROFILE`, `TEMP` geçici dizine yönlendirilir; `PATH` yalnız node).
> 6 test; `npm test` **415 → 421**; süre +2 sn. Gerçek `%TEMP%`, gerçek veri
> dizini ve kurulu araçlar üzerinde işlem yapılmaz. `--root` taraması
> report-only (0 hedef), `clean --dry-run` 0 silme, `quarantine` npm-global
> aracı taşımıyor. Parity ve PERF maddeleri hâlâ açık.

### 5.2 SAFE (yanlış silme)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| SAFE-01 | `report-only` küme | 0 silme hedefi | ✅ |
| SAFE-02 | Git tracked dosya | Hiçbir koşulda hedef değil | 🟡 (`scratch/test-root-git.ts`) |
| SAFE-03 | Kendi veri dizini | Aday gösterilmez; guard reddeder | ✅ |
| SAFE-04 | Ajan çalışma alanı | `agent-workspace`; 0 hedef | ✅ |
| SAFE-05 | Proje artefaktı | `project-artifact`; 0 hedef | ✅ |
| SAFE-06 | Model deposu | Varsayılan 0 hedef; yalnız `--nuke-models` | ✅ |
| SAFE-07 | Korumalı yolun atası | `guard` reddeder | ✅ |
| SAFE-08 | Junction / symlink | Bağ hedefi korunur | 🟡 (`scratch/test-junction.ts`) |
| SAFE-09 | Kasa geri yükleme | Çakışmada `.restored-*`; atomik | ✅ |
| SAFE-10 | Kalıcı silme | `SIL` yazılı onayı olmadan yok | ✅ |
| SAFE-11 | Kasa taşıma | `TASI`; orta riskte `SIL` kabul edilmez | ✅ |
| SAFE-12 | Profil değişimi | Sayı/hedef/plan/ifade değişmez | ❌ (T74) |

### 5.3 ERR (hata yolları)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| ERR-01 | ENOENT / kaybolan dosya | Atlanır, sayaç + neden | ✅ |
| ERR-02 | EACCES / EPERM | Sessiz 0 değil; uyarı | ✅ |
| ERR-03 | Keşif sınırı | `truncated` görünür; yarım liste "tam" sayılmaz | ✅ |
| ERR-04 | Yarım işlem | Journal `interrupted`; `recover` raporlar | ✅ |
| ERR-05 | Geçici hata | En fazla 3 deneme; iptal fatal değil | ✅ |
| ERR-06 | Geçersiz JSON gövde | 400; süreç ayakta | 🟡 |
| ERR-07 | 1 MB üstü gövde | 413; bağlantı kapanır | 🟡 |
| ERR-08 | Plan TTL / eski plan | 404/410; execute etmez | 🟡 |

### 5.4 SEC (HTTP kapıları)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| SEC-01 | Token yok | 401 | ✅ |
| SEC-02 | Yabancı `Host` / `Origin` | 403 | ✅ (Host) / 🟡 (Origin) |
| SEC-03 | Yalnız `127.0.0.1` | Dış arayüz dinlenmez | 🟡 |
| SEC-04 | Çerez | `HttpOnly` + `SameSite=Strict` | ✅ |
| SEC-05 | URL/HTML'de token | Yok | ✅ |
| SEC-06 | İstemci yol göndermez | Yalnız anahtar/kimlik | 🟡 (kod denetimi + shell-boundary) |
| SEC-07 | Gövde sınırı | 1 MB; aşımda 413 | 🟡 |
| SEC-08 | HKLM env yazma | Yönetici + `TEMIZLE` + yedek | 🟡 |

### 5.5 API

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| API-01 | Tüm GET uçları | 200 + `application/json` | ✅ |
| API-02 | Bilinmeyen küme/plan | 404 | ✅ |
| API-03 | Boş plan isteği | 400 | ✅ |
| API-04 | Geçersiz execute | 4xx; silme yok | ✅ |
| API-05 | Ayarlar PUT | Kaydedilir; kapalı güncelleme ağ isteği yapmaz | ✅ |
| API-06 | Plan kuralı | `PLANLA` yoksa 400; varsa 201 | ✅ |
| API-07 | Env planı | `TEMIZLE` + plan kimliği | ✅ |
| API-08 | Vault purge | Yanlış ifade 400 | ✅ |
| API-09 | Graf what-if | Boş istek 400 | ✅ |
| API-10 | SSE `Last-Event-ID` | Kaçırılan olaylar tampondan gelir | 🟡 |

### 5.6 PARITY (CLI ↔ API)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| PARITY-01 | `scan --json` ↔ `GET /api/disk` | Normalleştirilmiş eşitlik | ✅ (env taraması) |
| PARITY-01b | `scan --root` ↔ `/api/disk` | Kök taraması sonucu değiştirmez (T27) | ✅ |
| PARITY-02 | `clean --dry-run` ↔ `POST /api/plan` | Aynı hedef/ifade | ✅ |
| PARITY-03 | `inventory --json` ↔ `GET /api/cli/view` | Aynı sayaç/kanıt | ✅ (id/source/bayt) |
| PARITY-04 | `graph` ↔ `GET /api/graph` | Aynı düğüm/kenar | ❌ (T79) |
| PARITY-05 | `project` ↔ `GET /api/projects` | Aynı artifact/tarif | ❌ (T79) |

> **PARITY-01…03 otomatik (26.10.2026):** `tests/parity-e2e.test.ts` — gerçek CLI
> çocuk süreci + in-process API sunucusu, **tek sandbox**. PARITY-01 env kapsamlı
> tarama (`--env temp`) üzerinde küme anahtarı sırası, baytlar, hedef yolları ve
> karar türü eşitliğini doğrular; **PARITY-01b** kök taramasının `/api/disk`'i
> değiştirmediğini kanıtlar (T27/T10 tasarımı; eski "kök taraması ↔ `/api/disk`"
> beklentisi ürünle çelişiyordu ve bu yüzden ayrı alt test oldu). PARITY-03
> `status`/`confidence`/`evidence` alanlarını kapsam dışı bırakır (zamana duyarlı);
> eşitlik id + source + totalBytes üzerinde. `npm test` 446 → **450**.

### 5.7 SCHED / ENV

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| SCHED-01 | Kural oluşturma | `PLANLA` zorunlu | ✅ |
| SCHED-02 | Önizleme | Yalnız motor seçicisi; salt okunur | ✅ |
| SCHED-03 | Çalıştırma | Yalnız kasaya taşır; kalıcı silmez | 🟡 |
| SCHED-04 | Kaçırılan çalışma | `catchup` önerir; otomatik silmez | ✅ |
| SCHED-05 | Geçmiş | Kayıt + sonuç | ✅ |
| ENV-01 | Analiz | Salt okunur; yetim/gölge | ✅ |
| ENV-02 | Plan | `TEMIZLE` + yedek notu | ✅ |
| ENV-03 | Uygulama | Yedek yazılır; doğrulanır | 🟡 |
| ENV-04 | Makine PATH | Yönetici kapısı | 🟡 |

### 5.8 PERF / LOAD

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| PERF-01 | 10k dosya tarama | p95 süre + bellek eşiği yazılı | ✅ 1856 ms / 30.4 MB |
| PERF-02 | 100 küme disk görünümü | API p95 < eşik | ✅ p95 1.82 ms |
| PERF-03 | Kasa taşıma | dosya/sn + hata oranı | ✅ 4304 dosya/sn |
| LOAD-01 | 100k dosya | Çökme yok; RSS sınırı | ✅ 8.7 sn / 22.4 MB |
| LOAD-02 | 5k küme | API + sanal liste dayanır | ✅ p95 49.6 ms, payload 1.90 MB; gerçek tarayıcı: 5.000 küme, DOM **15 satır**, `/api/disk` 3.5 MB / 135 ms |
| LOAD-03 | 1k SSE olayı | Tampon taşmaz; sıra korunur | ✅ 2403 olay, tampon **2000** (403..2402), replay 5/5 tam 1000 olay p95 159.6 ms |
| LOAD-04 | 10 eşzamanlı istek | 5xx yok; kuyruk davranışı yazılı | ✅ p95 146 ms, 0 5xx |

### 5.9 WEB (gerçek tarayıcı)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| WEB-01 | İlk açılış / onboarding | 3 persona; varsayılan melez; atlanabilir | ✅ (T74/W2; elle, ego-browser) |
| WEB-02 | Disk tarama SSE | Canlı liste; iptal/duraklat/devam | 🟡 |
| WEB-03 | Plan + `TASI` | Özet; yüksek risk işareti; yazılı onay | 🟡 |
| WEB-04 | Kasa | Geri yükleme; çakışma; seçili boşaltma · denetim filtresi + CSV/JSON dışa aktarma (B24, elle doğrulandı) | 🟡 |
| WEB-05 | Araçlar | `SIL` planı; bağımlılık engeli | 🟡 |
| WEB-06 | PATH & Ortam | `TEMIZLE` duvarı; yedek dosyası | 🟡 |
| WEB-07 | Graf | What-if engeli gerekçeli | 🟡 |
| WEB-08 | Planlar | `PLANLA`; önizleme; çalıştır/sil | 🟡 |
| WEB-09 | Ayarlar | Kaydet; kapalı güncelleme ağ isteği yok | ✅ (T64/P4: salt okunur "Arka planda" bloğu) |
| WEB-10 | Klavye-only tur | Tüm akış; odak tuzağı; `Esc` | 🟡 |
| WEB-11 | Ekran okuyucu | `aria-*`, canlı bölge, `role=alert` | 🟡 |
| WEB-12 | `prefers-reduced-motion` | Animasyon kapanır | ✅ global `*` kuralı (`web/src/styles.css:4705-4714`) tüm animasyon/geçişi kapatır |
| WEB-13 | TR/EN | Tüm yeni ekranlar | 🟡 |
| WEB-14 | Dar ekran (≤820px) | Menü paneli; taşma yok | 🟡 |
| WEB-15 | Hata durumları | 401/403/404/500 kullanıcıya görünür | ✅ `role=alert` bandı gerçek tarayıcıda 500 ile doğrulandı (`App.tsx:1086-1089`) |
| WEB-16 | Yeniden bağlanma | SSE `Last-Event-ID`; sayaç | 🟡 |
| WEB-17 | F5 kanıt rozetleri | state/history/atime/install ayrımı | ✅ motor `F5-1..F5-4`; TR/EN etiket testi; gerçek tarayıcıda dört sinyal + atime uyarısı görüldü |
| WEB-18 | Sağ panel | Modül seçimi; planlananlar; TTL temizliği | ✅ (T64/P1: gizle/göster menüsü, `localStorage`, son modül korunur) |

### 5.10 PROFILE (T74 — bağlayıcı)

| ID | Senaryo | Kabul | Durum |
|---|---|---|---|
| PROFILE-01 | Varsayılan | `hybrid`; ilk açılış | ✅ `tests/profile.test.ts` + onboarding (elle) |
| PROFILE-02 | Geçersiz değer | `hybrid`'e düşer; restart korur | ✅ `normalizeUserProfile` + `PROFILE API-01/02`; restart elle doğrulandı |
| PROFILE-03 | Disk değişmezliği | `/api/disk` sayı/karar/hedef/seçim aynı | ✅ `PROFILE API-03` |
| PROFILE-04 | Plan değişmezliği | Plan + onay ifadesi aynı | ✅ `PROFILE API-04` (hedef + bayt kilidi) |
| PROFILE-05 | Tarama yok | Profil değişimi `/api/scan` çağırmaz | ✅ `PROFILE API-05` |
| PROFILE-06 | Güvenlik | `report-only` + `guard` üç profilde geçer | ✅ `PROFILE-06`: her profilde report-only plan 400, guard reddi 400, `verdictKind` aynı (`tests/profile-api.test.ts`) |
| PROFILE-07 | A11y | Klavye + ekran okuyucu + reduced motion | 🟡 reduced motion CDP emülasyonuyla doğrulandı (tüm animasyonlar `1e-06s/1`); ekran okuyucu turu ve klavye/odak onboarding'de elle |

---

## 6. Ölçüm komutları

```bash
npm run typecheck
npm test
npm run build:web
npm run smoke
node --import tsx --test --experimental-test-coverage tests/*.test.ts
```

Ölçüm sonucu bu belgeye **tarih + commit** ile yazılır; sayı ezberden
güncellenmez.

---

## 7. Açık riskler (öncelik sırası)

1. **`delete.ts` yürütme döngüleri test dışı** — satır %61.2 / fonksiyon
   %34.4 (109-214 purge, 220-304 taşıma); hata enjeksiyonu (ERR-01…08) yok.
   Beta kapısının ana maddesi.
2. **Git tracked + junction silme koruması `npm test` dışında** — scratch
   kanıtı var; otomatik regresyon yok.
3. **Web UI otomatik E2E yok** — M5, B24, B19/B21 ve T74/W2 **elle**
   doğrulandı (ego-browser); WEB-15/WEB-17 bu turda tarayıcıda kanıtlandı,
   PROFILE-07 ekran okuyucu turu otomatik değil.
4. **Backlog hijyeni** — tamamlanan iş açık kalabiliyordu: B23 (27.10,
   `a8e7110`) ve B24 (28.10, `fd87707`) backlog'da hâlâ `planned`, B22
   `done` ama `doneAt`/`commit` yoktu. 28.10.2026'da üçü `done` + commit ile
   işaretlendi. 28.10.2026 akşamı kök neden bulundu: `residue status`
   sayacı yalnız `status === 'todo'` arıyordu, `state.json` ise `planned`
   yazıyordu → düzeltildi (motor `src/core/task-view.ts`, 7 test).

**Kapatılan riskler (05.11.2026):**
- **Eski geri dönüşüm kutusu yolu** — `src/actions/restore.ts` silindi;
  `exists()` `src/util/path-exists.ts`'e taşındı, `src/web/server.ts:22`
  yeni util'i kullanıyor. Kasa akışı zaten `vault.ts` üzerinden.
- **`scan-verify` teardown flake'i** — test tarafında `rmRetry()`
  (`maxRetries:20, retryDelay:100`) kullanılıyor; ürün kodu değişmedi.
- **PROFILE-06** — üç profilde gerçek guard koşusu otomatikleşti.


---

## 8. Beta kaniti (03.11.2026)

| Madde | Kanit |
|---|---|
| ERR-01/02 ENOENT + EACCES/EPERM | `tests/delete-errors.test.ts` (10 test, enjekte edilmis batch/move/remove hatalari) |
| ERR-06 bozuk JSON | `tests/api.test.ts`: 400, sunucu ayakta |
| ERR-07 govde siniri | `tests/api.test.ts`: 1 MB uzeri 413 |
| ERR-08 plan TTL | `tests/plan-ttl.test.ts`: 410 + kayit silinir, sonraki 404 |
| SAFE-02 Git tracked | `tests/safety-fs.test.ts`: gercek `git init` + tracked klasor korunur |
| SAFE-08 junction | `tests/safety-fs.test.ts`: junction hedefi ve ustasi korunur |
| SEC-02 Origin | `tests/api.test.ts`: yabanci Origin 403, ayni origin 200 |
| SEC-03 loopback | `tests/api.test.ts`: `127.0.0.1` adresi test edilir |
| SEC-07 govde | `tests/api.test.ts`: 1 MB uzeri 413 |
| PROFILE-06 | `tests/profile-api.test.ts`: uc profilde report-only 400, guard 400, `verdictKind` ayni |
| WEB-17 | `tests/inventory-usage-verdict.test.ts` F5-1..F5-4 + `tests/evidence-badges.test.ts` (TR/EN) |
| WEB-15 | ego-browser: dashboard `/api/dashboard` 500 -> `role=alert` "Bağlantı hatası / ... / Yeniden dene" |
| WEB-17 UI | ego-browser Tools: `kurulum/durum/erişim/geçmiş` + `atime kurulum anı` rozetleri (17 araç) |
| PROFILE-07 motion | CDP `prefers-reduced-motion: reduce`: spin/skeleton/indeterminate `1e-06s / 1` |
| Kasa mesajı | `tests/vault-restore.test.ts` (empty/newer/older/cancel) + `tests/vault-message.test.ts` (TR/EN, "dolu" yasağı) |
| Kasa boşaltma bildirimi | `tests/vault.test.ts` (newer notice + payload'sız kayıt) + `tests/vault-message.test.ts` (purgeNewer/purgePruned TR/EN) |
| T95 purge kaldırma | `tests/delete-errors.test.ts` (red + dosya yerinde), `tests/approval.test.ts` (400), `tests/plan-add.test.ts` (API 400), `tests/cli-e2e.test.ts` (`--purge` exit 1) |
| Kapsam | 745 test (06.11.2026); satir 86.29 / dal 80.15 / fonksiyon 80.32 (03.11.2026 olcumu) |

**Acik kalan:** PROFILE-07 ekran okuyucu turu otomatik degil (NVDA yok);
WEB-15/WEB-17 ve reduced motion tarayici kaniti 05.11.2026'da alindi;
T95 dogrudan yol kalici silme 06.11.2026'da kaldirildi. Test sayisi
**745/745**.
