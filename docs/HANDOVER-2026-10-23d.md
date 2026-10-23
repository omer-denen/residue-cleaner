# HANDOVER — 23.10.2026 · WEB arayüzü + plan paneli

**Sürüm:** `0.3.0-alpha.0` (npm'e yayınlanmadı)
**Dal:** `orkestrator` → `main`
**Son commit:** `2e6d506` (main aynı)
**Test:** **319/319** · typecheck temiz
**Protokol:** `ORKESTRATOR.md` · **Kayıt:** `docs/ORCHESTRATOR-LOG.md`

---

## 1. Bu oturumda netleşen kararlar

1. **Üç kullanıcı profili zorluk/hız ayarı değildir.** Kanonik tanım:
   `docs/PROFILE-MODEL.md`. Üç ayrı eksen:
   - kullanıcı personası: `developer` / `vibe` / `hybrid` (varsayılan hybrid)
   - tarama kapsamı: `lean` / `audit` / `full` (`src/core/discover.ts`)
   - grafik bakışı: `protect` / `experiment` (yalnız sıra)
   "Hızlı/derin temizlik" modu **yok**; persona yalnız sunum + varsayılan
   görünüm seçer. Karar motoru ve güvenlik kapıları değişmez.
2. **Readiness:** `docs/READINESS-MATRIX.md` — ağırlıklı skor **68.00**,
   alpha eşiği 70 (açık), 90 E2E senaryosu. CLI E2E, parity, perf/load ve
   web tarayıcı E2E açık.
3. **Arayüz yönü:** `docs/UI-REDESIGN-2026-10-23.md`
   - liste alanı büyür, yalnız liste kaydırılır;
   - sağ panel 300–560 px yeniden boyutlandırılabilir (varsayılan 380);
   - plana alınan dosya/klasörler sağ panelde gruplu görünür, tek tek çıkar;
   - listede `Planda` rozeti; plana ekleme sayfadan ayrılmadan yapılır.

---

## 2. Bu oturumda tamamlananlar

| İş | Commit | Not |
|---|---|---|
| Profil modeli | `276fb62` | `docs/PROFILE-MODEL.md`, T44 §1 tarihsel |
| W0-a readiness | `1ad5da5` | `docs/READINESS-MATRIX.md` (90 senaryo) |
| Arayüz planı | `061c1fe` | `docs/UI-REDESIGN-2026-10-23.md` |
| Plan paneli motor/API | `2e6d506` | `PlanPanelView`, `POST /api/plan/remove` |

**Plan paneli API ayrıntısı:**
- `PlanResponse.panel: PlanPanelView` — gruplar bayt azalan, hedefler bayt
  azalan; `keys`, `clusterCount`, `targetCount`, `totalBytes`.
- `planTargetId(clusterKey, path)` — FNV-1a, kararlı `t-xxxxxxxx`.
- `DeleteService.removeFromPlan(planId, { key?, targetId? })`:
  küme veya tek hedef çıkarır; baytları ve onay gereksinimlerini yeniden
  hesaplar; plan boşalınca kaydı siler ve `null` döner.
- `POST /api/plan/remove` — istemci **yol göndermez**, yalnız `planId` +
  `key`/`targetId`.
- Test: 310 → **319** (+9); typecheck temiz.

---

## 3. Yapılmayan / sıradaki iş

### W1 — Web arayüzü (T74) — HENÜZ BAŞLAMADI

Tasarım `docs/UI-REDESIGN-2026-10-23.md`'de hazır. Uygulama beyaz listesi:

```
web/src/App.tsx                 (panel genişliği + ayırıcı + plan durumu)
web/src/api.ts                  (removeFromPlan)
web/src/components/PlannedModule.tsx  (gruplu plan paneli)
web/src/components/icons.tsx    (chevron, file, folder, trash)
web/src/screens/Disk.tsx        (Planda rozeti, Plana ekle, kompakt başlık)
web/src/i18n.ts                 (yeni anahtarlar; TR/EN)
web/src/styles.css              (yeni kabuk/liste/panel stilleri)
```

Kabul:
- Sağ panel sürüklenerek 300–560 px; çift tık 380; `localStorage`.
- Disk satırında `Planda` rozeti; plana ekleme sayfadan ayrılmadan.
- Plan paneli: toplam bayt, küme/hedef sayısı, TTL, gruplar, hedef yolları,
  tek tek/küme çıkarma, boş durum, `role=alert` hata.
- Yalnız liste kaydırılır; sayfa iç içe kaymaz.
- `npm run typecheck` + `npm test` + `npm run build:web`.

### ego-browser notu (ÖNEMLİ)

Bu oturumda ego-browser **çalışmadı** çünkü tüm oturum (Explorer dahil)
**High integrity / yönetici** açılmıştı:

```
explorer integrity=high  ego integrity=high  self integrity=high
```

ego-browser medium-integrity terminal/Explorer ister. Sınırlı görev denendi;
yine High çalıştı. **Çözüm:** bir sonraki oturumu **yönetici olmayan** normal
bir terminalde açın:

```powershell
# Yönetici DEĞİL
ego-browser nodejs -e "console.log('ego ok')"
```

Sonra `ego-browser skill` çıktısını izleyin; tek TaskSpace oluşturun.
Headless Edge/CDP bu oturumda yalnız geçici doğrulama için kullanıldı;
kalıcı akış ego-browser olacak.

### Diğer açık kalemler

- T37 — yarım güncelleme artıkları.
- T69/F5 — kanıt türü rozetleri (web).
- CLI E2E + CLI↔API parity + perf/load (readiness alpha kapısı).
- `delete.ts` / `vault.ts` hata enjeksiyonu (beta).

---

## 4. Giriş komutları

```powershell
cd C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator
git status                 # temiz olmalı; main: 2e6d506
npm run typecheck
npm test                   # 319/319
npm run build:web
# eski sunucuyu kapat (K15), sonra:
node bin/residue.mjs ui --web --no-browser --port 4411
```

Tarama verisi mevcut; gerçek silme/plan çalıştırma **yapılmadı**.

---

## 5. Açık riskler

1. **ego-browser yükseltilmiş oturumda açılmaz** — yeni oturum normal
   yetkide açılmalı; aksi halde görsel doğrulama yapılamaz.
2. `PlanPanelView` yeni zorunlu alan; eski istemci yanıtı yok sayar, kırılmaz.
3. UI uygulaması henüz yok; `Planda` rozeti ve panel çıkarma uçtan uca
   denenmedi (API testleri var).
4. Readiness skoru 68.00; alpha kapısı için CLI E2E/parity/perf gerekli.
5. `scratch/` altındaki ekran görüntüleri ve görev dosyaları gitignore'da;
   ürüne girmez.
