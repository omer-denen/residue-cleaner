# HANDOVER — 23.10.2026 · T30 kapandı; sıradaki oturum **WEB**

**Sürüm:** `0.3.0-alpha.0` (npm'e yayınlanmadı)
**Orkestratör worktree:** `C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator`
**Dal:** `orkestrator` → `main`
**İşçi model:** `opencode-go/glm-5.3-flash` (Free kotası dolduğu için kullanıcı onayıyla)
**Protokol:** `ORKESTRATOR.md` · **Kayıt:** `docs/ORCHESTRATOR-LOG.md`

---

## 1. Bu oturumda kapanan işler

| İş | Commit | Test |
|---|---|---|
| P4 kalanı (E10a/b, E10c, E11, C11) | `e95c50b` … `3efccbc` | 226 → 259 |
| T54 — eski ad (`clicleaner`) kaldırıldı | `893331c` | +4 |
| T69/F1 — atime observer hijyeni | `8d9610a` | +5 |
| T69/F2 — durum kanıtı (log/Programs) | `a783f3e` | +6 |
| T69/F3 — kullanım kararı (atime doğrulaması) | `277bf73` | +12 |
| T69/F4 — kabuk geçmişi ayrıştırıcı | `ec9478d` | +18 |
| **T30 — model-store kanıtı** | `58fa537` | +10 |
| **Toplam** | | **310/310** |

**Açık:** T69/F5 (görsel kanıt türü rozetleri) · T37 (yarım güncelleme artıkları) · T74 (web).
**Web kapısı:** Kullanıcı 23.10.2026'da **web arayüzü güncelleme/geliştirmesine
bir sonraki oturumda başlama onayı** verdi.

---

## 2. “Web olmadan tam test edilebilir mi?” — net cevap

**Hayır, yayın düzeyinde tam test edilemez; ama motor/CLI/API test edilebilir.**

| Katman | Web olmadan test | Not |
|---|---|---|
| Karar motoru (`classifier`, `analyze`, `merge`, `selection`, `discover`, `walker`) | ✅ | `npm test` + CLI E2E |
| Güvenlik (`guard`, `approval`, `vault`, `delete`) | ✅ | birim + CLI E2E |
| Servisler (`scan/delete/cli/schedule/env/project`) | ✅ | API/CLI üzerinden |
| CLI (`scan`, `clean`, `inventory`, `repair`, `quarantine`) | ✅ | JSON çıktısı oracle |
| HTTP adaptörü | 🟡 | `smoke` 34 kontrol; tam E2E yok |
| Web UI (durum/güven/kanıt, onay duvarı, SSE, a11y, profiller) | ❌ | tarayıcı E2E gerekir |
| F5 (kanıt türü rozetleri) | ❌ | UI değişikliği |

Aynı motor kullanıldığı için **sınıflandırma/plan/hedef/bayt sonuçları aynıdır**;
farklı olan adaptör ve sunumdur. Bu yüzden sıradaki oturum web ile başlıyor.

---

## 3. Sıradaki oturumun kapsamı

### W0 — Web readiness & alignment (önce)

1. **F5:** Tools ekranında “kanıt türü” rozetleri (state / history / atime /
   install) + mevcut güven rozeti; “Yakında” yalnız doğrulanmış sinyalde.
   - Kural 18: hesap motorda; UI yalnız gösterir.
   - Motor tarafı `usageVerdict` zaten `evidence` + `confidence` üretiyor;
     gerekirse `basis` alanı `contract.ts` + servis üzerinden taşınır.
2. **Parity:** `scan --json` ↔ `/api/disk`, `clean --dry-run` ↔
   `POST /api/plan`, `inventory --json` ↔ `/api/cli/view` normalleştirilmiş
   eşitlik. Son değişikliklerin (T54, E11, T30, GPU üçlü durum) UI’a yansıması.
3. **Web E2E:** çerez/token 401, Host/Origin 403, gövde limiti, SSE +
   `Last-Event-ID`, plan TTL, yazılı onay ifadeleri, vault restore/purge,
   settings/schedules.
4. **A11y/klavye:** mevcut M5 kazanımlarını koru; yeni ekranlarda
   `prefers-reduced-motion`, odak tuzağı, `aria-*`.

### W1 — T74: 3 profilli dinamik arayüz

- Profiller: **developer / vibe coder / melez** (varsayılan melez).
- Profil yalnız **sunum + varsayılan görünüm** seçer; karar motoru ve
  güvenlik kapıları aynı kalır.
- Onboarding + Ayarlar’dan değiştirme; veri yeniden taranmaz.
- TR/EN, klavye-only, ekran okuyucu üç profilde zorunlu.

### Değişmez web kuralları

- `web/src` karar mantığı içermez (filtre/sıralama/toplam/onay ifadesi).
- İstemci **yol göndermez**; yalnız anahtar/kimlik.
- Yalnız `127.0.0.1`; çerez `HttpOnly + SameSite=Strict`.
- Onay ifadeleri `ApprovalRules`’tan gelir (`TASI`, `SIL`, `BOŞALT`,
  `PLANLA`, `TEMIZLE`, `ONAR`, `KARANTINA`).
- K15: önce `npm run build:web`, sonra sunucuyu yeniden başlat; eski süreci kapat.

---

## 4. Readiness Matrix — başlangıç verisi (Faz 1)

Son kapsam ölçümü (310 test):

| Sınıf | Satır | Dal | Fonksiyon |
|---|---:|---:|---:|
| `analyze.ts` | 92.22 | 78.82 | 79.78 |
| `classifier.ts` | 94.58 | 80.16 | 74.03 |
| `discover.ts` | 96.79 | 70.83 | 94.44 |
| `walker.ts` | 91.11 | 76.19 | 84.62 |
| `merge.ts` | 65.22 | 100.00 | 12.50 |
| `selection.ts` / `selection-scope.ts` | 100 / 94.85 | 85 / 90.48 | 100 / 85.71 |
| `guard.ts` / `approval.ts` | 100 / 100 | 86.36 / 92.31 | 100 / 100 |
| `vault.ts` / `delete.ts` | 88.30 / **57.40** | 61.11 / **44.00** | 72.73 / **32.26** |
| `cli-inventory.ts` | 63.35 | 81.97 | 41.56 |
| `scan-service.ts` / `delete-service.ts` | 69.38 / 68.87 | 56.67 / 59.26 | 52.17 / 69.23 |
| `web/server.ts` | 69.96 | 54.10 | 34.29 |
| **Tümü** | **79.93** | **74.87** | **67.27** |

**Ön hazırlık skoru ≈ 68/100** (işlevsel 80, güvenlik değişmezleri 85,
hata 55, güvenlik 70, performans 0, yük 0, gözlemlenebilirlik 80).
**Alpha eşiği 70; beta 85.** Performans/yük ölçülmedi.

Faz 1’de `docs/READINESS-MATRIX.md` oluşturulacak: sınıf × boyut × seviye,
ağırlıklar, alpha/beta kapıları, E2E senaryo kataloğu (ID + kabul + kanal).
E2E kataloğu: CLI, SAFE, ERR, SEC, API, PARITY, SCHED, ENV, PERF, LOAD,
WEB (onay sonrası).

---

## 5. Açık riskler

1. **`delete.ts` / `vault.ts` düşük kapsam** — beta için en büyük açık;
   hata enjeksiyonu ve E2E şart.
2. **Performans/yük ölçümü yok** — p95/RSS eşikleri tanımsız.
3. **`web/server.ts` kapsamı düşük** (34% fonksiyon) — web E2E şart.
4. **T37 açık** — yarım güncelleme artıkları (`.\*paket-rastgele`).
5. **K21:** `fs.utimes` sayı ms ile Windows’ta `EINVAL`; `Date` kullan.
6. **T30 sınırı:** `data.bin` genel ad sayılmaz; model-store report-only;
   log klasörleri kapsam dışı.

---

## 6. Giriş komutları

```powershell
cd C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator
npm run typecheck
npm test                     # 310/310
npm run build:web
# eski sunucuyu kapat (K15), sonra:
node bin/residue.mjs ui --web --no-browser --port 4411
npm run smoke                # 34 kontrol
```

---

## 7. Sıradaki oturumun ilk adımları

1. `AGENTS.md`, bu devir, `ORKESTRATOR-LOG.md` oku; baseline `npm test` doğrula.
2. **Faz 1:** `docs/READINESS-MATRIX.md` + E2E senaryo kataloğu.
3. **W0:** F5 + CLI/API parity + web E2E.
4. **W1:** T74 3 profil.
5. T37’yi web oturumundan sonra veya paralel web dışı iş olarak ele al.
