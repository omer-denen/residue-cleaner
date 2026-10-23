# HANDOVER — 23.10.2026 · WEB W1: panel + plan paneli

**Sürüm:** `0.3.0-alpha.0` (npm'e yayınlanmadı)
**Dal:** `orkestrator` → `main` (fast-forward)
**Son commit:** `0685eee` (devir) · W1-b `f194eb2` · W1-a `4cc1ed5`
**Test:** **319/319** · typecheck temiz · `npm run smoke` **35/35** ·
`npm run build:web` **126.44 kB gzip**
**Protokol:** `ORKESTRATOR.md` · **Kayıt:** `docs/ORCHESTRATOR-LOG.md`

---

## 1. Bu oturumda tamamlananlar

| İş | Commit | Dosyalar | Not |
|---|---|---|---|
| W1-a — yeniden boyutlandırılabilir panel + Disk listesi | `4cc1ed5` | `web/src/App.tsx`, `web/src/screens/Disk.tsx`, `web/src/i18n.ts`, `web/src/styles.css`, `web/src/components/icons.tsx` | 5 dosya, +449/−149 |
| W1-b — sağ panel plan grupları + hedef çıkarma | `f194eb2` | `web/src/App.tsx`, `web/src/api.ts`, `web/src/components/PlannedModule.tsx`, `web/src/components/icons.tsx`, `web/src/i18n.ts`, `web/src/styles.css` | 6 dosya, +430/−91 |

### W1-a — ne yapıldı

- **Panel genişliği:** 300–560 px (varsayılan **380**), `localStorage:
  residue.panelWidth`; 8 px ayırıcı (`role="separator"`,
  `aria-valuemin/max/now`), fare ile sürükleme, `ArrowLeft/Right` ±16,
  `Home` 300 / `End` 560, çift tık 380.
- **Yerleşim:** `.shell` grid'i `208px minmax(0,1fr) 8px var(--right-w,380px)`;
  rail daraltılmış ve `shell-wide` varyantları güncellendi; ≤1180 px'te panel
  ve ayırıcı gizli (mevcut davranış).
- **Disk:** `main-fill` yalnız Disk'te; `.disk`/`.disk-main` dikey flex;
  `.cluster-scroll` `flex:1` + `overflow:auto` → **yalnız liste kaydırılır**.
  Kısa ekran güvencesi (`max-height:700px`) sayfaya kaydırmaya döner.
- **Kompakt başlık/araç çubuğu:** başlık + tarama rozeti + "Yeniden tara" tek
  satır; 1. satır arama + durum sekmeleri + **Filtreler**; 2. satır ortam
  çipleri (yatay kaydırma); gelişmiş filtreler varsayılan **kapalı**.
- **`Planda`:** `App` → `Disk` `plannedKeys` (motorun `panel.keys` alanı);
  satırda accent zemin + sol çizgi + `Planda` rozeti (check ikonu + metin).
- **Plana ekle:** mevcut `panel.keys` + seçim birleşir → `POST /api/plan`;
  sayfa değişmez, sağ panel `Planlananlar` sekmesine geçer, seçim temizlenir.
  Plan onayı/kelime doğrulaması **Plan ekranında** kalır.
- Satır 40 px; virtualizer `estimateSize: 40`; grid son sütun 96 px.

### W1-b — ne yapıldı

- **`api.removeFromPlan(planId, { key | targetId })`** → `POST /api/plan/remove`.
  İstemci **yol göndermez**; yalnız kimlik. Sunucu plan kimliğini ve TTL'i korur.
- **`PlannedModule`:** özet (toplam bayt 20 px mono, küme/hedef sayısı,
  `mm:ss` TTL — yalnız gösterim), gruplu hedefler (katlanır başlık, risk
  noktası + `aria-label`, `N hedef · boyut`), hedef satırları (nötr dosya
  ikonu, tek satır yol + `title`, etiket, boyut, `×`), küme çıkarma, boş durum,
  `role="alert"` hata, alt eylem "Planı aç" + kısa plan kimliği.
- **App:** `removePlanned(selector)` artık `removeFromPlan` kullanıyor; panel
  rozeti `planned.panel.clusterCount`; Plan ekranı aynı `plan` durumuyla
  senkron; 404/410'da `planned` + `plan` temizlenir.
- `icons.tsx`: `chevronDown`, `file` eklendi (yalnız sunum).

---

## 2. Kapılar (doğrulama)

| Kapı | Sonuç |
|---|---|
| Baseline | typecheck temiz · **319/319** |
| W1-a sonrası | typecheck temiz · **319/319** · build **125.67 kB gzip** |
| W1-b sonrası | typecheck temiz · **319/319** · build **126.44 kB gzip** |
| HTTP smoke (`npm run smoke`) | **35/35** temiz (cookies, 401/403, tüm GET uçları, onay kapıları) |
| Diff denetimi | yalnız beyaz liste; `src/` dokunulmadı; test silinmedi/zayıflatılmadı; uygulama adı yok |
| Gerçek tarayıcı | **YAPILMADI** — aşağıdaki ego-browser engeli |

### Orkestratörün yaptığı küçük mekanik düzeltmeler

1. `.filters-advanced[hidden] { display: none; }` — `hidden` özniteliği
   `display:flex` tarafından eziliyordu; filtreler kapalıyken görünür kalırdı.
2. `.page-actions { display:flex; gap:8px; }` — başlık sağındaki rozet + düğme
   hizası.
3. `onPlanStale` artık `setPlan(null)` **ve** `setPlanned(null)` — 404/410'da
   Plan ekranındaki bayat plan da temizlenir.
4. Plan grubu risk noktasına `role="img"` + `aria-label` (renk tek başına
   anlam taşımasın).

---

## 3. Açık iş — W1 görsel/DOM doğrulaması

Tasarım: `docs/UI-REDESIGN-2026-10-23.md`. Aşağıdakiler **henüz gerçek
tarayıcıda denenmedi**:

1. 1440×900: `.panel-resizer` var, `aria-valuenow=380`; sürükleme 300–560;
   `localStorage.residue.panelWidth` yazılıyor; çift tık 380; `ArrowLeft` +16.
2. Disk'te sayfa kaymıyor; `#cluster-list` (`.cluster-scroll`) kaydırılıyor;
   liste viewport'a göre büyüyor (52vh değil).
3. Plan oluştur → Disk'te ilgili satırda `Planda` + accent sol çizgi.
4. Seçim + **Plana ekle**: sayfa değişmiyor, panel `Planlananlar`'a geçiyor,
   seçim sıfırlanıyor, toplam artıyor, mevcut anahtarlar korunuyor.
5. `Filtreler` kapalıyken gelişmiş alanlar görünmüyor; açınca tüm filtreler
   çalışıyor; `/` aramaya odaklanıyor.
6. Plan paneli: TTL azalıyor; tek hedef çıkar → yalnız o satır gider,
   `planId` **değişmez**; küme çıkar → grup gider; son hedef de giderse boş
   durum; Plan ekranı aynı planı gösterir.
7. TR/EN, `aria-expanded`, `aria-label`'lar, konsol hatası yok.
8. Diğer ekranlar (Genel Bakış, Plan, Araçlar) kaydırma/düzen açısından bozulmadı.

### ego-browser engeli (bu oturum)

Oturum **High integrity** (yönetici) açıldığı için ego-browser çalışmadı:

```
ego-browser is elevated and its medium-integrity relay failed.
Explorer is not running at medium integrity
```

`ego-browser skill` çalışıyor; `ego-browser nodejs` çalışmıyor. Kural 19
gereği headless Edge/CDP'ye kullanıcı onayı olmadan geçilmedi.

**Çözüm (kullanıcı kararı):** bilgisayarı kapatıp yeniden açmak; OpenCode'u
**yönetici olmayan** normal bir terminalde, her zamanki gibi proje içinde
`opencode` yazarak başlatmak. Ekstra prosedür **yok**; tek koşul terminalin
"Yönetici olarak çalıştır" ile açılmamış olması.

Doğrulama:

```powershell
whoami /groups | Select-String "High Mandatory"   # boş olmalı
ego-browser nodejs -e "console.log('ego ok')"     # ego ok
```

Sonra `ego-browser skill` çıktısını izle; **tek** TaskSpace oluştur ve aynı
`spaceId`/`page` ile devam et.

### Sunucu (K15)

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -ge 4300 -and $_.LocalPort -le 4500 } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

cd C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator
npm run build:web
node bin/residue.mjs ui --web --no-browser --port 4411
```

Tarama verisi mevcut; **gerçek silme/plan çalıştırma yapılmadı.**

---

## 4. Diğer açık kalemler

- **T69/F5** — kanıt türü rozetleri (state/history/atime/install) web'de;
  W1 ile birlikte ele alınacak.
- **W0-b** — CLI E2E + CLI↔API parity + perf/load; readiness alpha eşiği
  (68.00 → 70) hâlâ açık.
- **T37** — yarım güncelleme artıkları (gizli `.paket-rastgele` klasörler).
- **T74 W2** — üç persona (`developer` / `vibe` / `hybrid`); yalnız sunum +
  varsayılan görünüm; karar motoru ve güvenlik kapıları değişmez.
- `delete.ts` / `vault.ts` hata enjeksiyonu (beta).

---

## 5. Riskler

1. **Görsel doğrulama yok.** W1-a/b kod + tip + HTTP smoke ile doğrulandı;
   yerleşim/scroll/rozet davranışı gerçek tarayıcıda denenmedi. İlk iş bu.
2. **TTL yalnız gösterim.** Panel `mm:ss` sayacı istemcide hesaplanır;
   geçerlilik kararı sunucudadır (`410`). Plan kimliği/TTL çıkarmada korunur.
3. **`plannedKeys` üyeliği** `panel.keys`'ten gelir; filtre/sıralama/plan
   kapsamı hesabı arayüzde yok (kural 18).
4. **Resizer pointer capture** sürükleme sırasında `body.resizing` sınıfı
   ekler; `pointerup/cancel` temizler. Pencere dışında biten sürükleme için
   `pointercancel` yolu var; gerçek tarayıcıda denenmeli.
5. **`main-fill` yalnız Disk'te.** Diğer ekranlar `main` kaydırmasını korur;
   kısa ekran (<700 px) Disk'te sayfaya kaydırmaya döner.
6. **UI testleri yok.** `npm test` motor/API testleridir; React bileşenleri
   için jsdom/testing-library bağımlılığı yok. Tarayıcı E2E ilk turda elle.

---

## 6. Giriş komutları (yeniden başlatma sonrası)

```powershell
# 1) Normal (yönetici DEĞİL) terminal
cd C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator
git status                 # temiz; HEAD f194eb2
npm run typecheck
npm test                   # 319/319
npm run build:web

# 2) ego-browser kontrolü
ego-browser nodejs -e "console.log('ego ok')"

# 3) Sunucu (eski süreci kapatarak)
node bin/residue.mjs ui --web --no-browser --port 4411
```

`main` bu oturum sonunda `0685eee`'ye fast-forward edildi; ana repoda
typecheck + test yeniden çalıştırıldı. Kod iki dalda da aynı.

**Devir belgesi:** bu dosya · **Kayıt:** `docs/ORCHESTRATOR-LOG.md` ·
**Önceki:** `docs/HANDOVER-2026-10-23d.md`
