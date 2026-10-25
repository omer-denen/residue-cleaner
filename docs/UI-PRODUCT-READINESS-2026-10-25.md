# Arayüz ürünleşme günlüğü — 25.10.2026

> **Durum:** yürürlükte. Bu dosya hem karar günlüğü hem de faz listesidir.
> **25.10.2026 ara durum:** Yol haritası onaylandı. Bu oturumda kod
> değişikliği bırakılmadı; Faz 0/1/2 denemeleri geri alındı ve yalnız
> `scratch/ui-product-2026-10-25/faz0-2-taslak.patch` (git dışı) olarak
> saklandı. Sıradaki oturum Faz 0'dır.
> **25.10.2026 2. tur (inceleme eki):** harita gerçek kodla karşı
> inceleme yapıldı; `--faint` kontrast düzeltmesi, eksik belirteçler,
> Faz 0 kabul detayları ve Gelişmiş mod kapsamı eklendi (§8).
> Sıradaki yine Faz 0'dır.
> **Kapsam:** web arayüzü (`web/`), görsel sistem ve ekran yerleşimleri.
> **25.10.2026 3. tur:** **Faz 0 kapandı** (UI-001..UI-003; §9), **Faz 1
> kapandı** (UI-004..UI-006; §10) ve **Faz 2 kapandı** (UI-007..UI-008; §11).
> Sıradaki: Faz 3 (UI-009 — ortak ekran cilası).
> **Değişmez kurallar:** `AGENTS.md` kural 18 (karar motorda), iki aşamalı
> onay, `report-only`, `guard.ts`, localhost + çerez kapıları.
> **İlke:** bu turda **hiçbir karar kuralı değişmez**; yalnız görünüm,
> hiyerarşi, boş durumlar ve akış netliği iyileşir.

---

## 1. Proje neden başladı (loglardan özet)

`SESSION_LOG.md`, `README.md` ve devir belgelerindeki kuruluş gerekçesi:

- Kod yazan bir bilgisayarda yer kaplayan şeylerin çoğu **tek bir uygulamaya
  ait değildir**: CLI önbellekleri, paket depoları, ajan oturum klasörleri,
  güncelleyici artıkları. Windows "Program ekle/kaldır" listesinde
  görünmezler; bu yüzden kullanıcı ne olduğunu bilmeden silmek zorunda kalır.
- Residue'un cevabı **isimle değil kanıtla sınıflandırmak**tır:
  `CACHEDIR.TAG`, `*.nupkg`, `model.onnx`, `pyvenv.cfg`, `sdk/ + shared/`
  gibi yapısal işaretler. Yeni bir araç çıktığında kural eklemek gerekmez.
- Kullanıcıya **karar gerekçesi** gösterilir; silme **iki aşamalı onay** ister
  ve varsayılan yol **geri alınabilir kasa**dır.
- Bu üç sütun (kanıt · gerekçe · geri alınabilirlik) arayüzün de
  değişmezidir. Arayüz "sihirli temizleyici" gibi davranamaz; kanıtı
  saklayamaz, onayı hızlandıramaz, `report-only` öğeyi silemez.

**Ürün cümlesi:** *Hiçbir şeyi adına göre değil kanıta göre sınıflandır;
kararı gerekçesiyle göster; silmeyi kullanıcıya iki aşamada onaylat.*

---

## 2. Bugünkü durum (25.10.2026 sabahı)

Ekran görüntüleri: `scratch/ui-product-2026-10-25/`
(`10-dashboard.png`, `02-disk.png`, `03-tools.png`, `10-projects.png`,
`10-env.png`, `10-graph.png`, `10-schedules.png`, `04-plan.png`,
`05-settings.png`).

Gözlenen sorunlar:

| # | Belirti | Etki |
|---|---|---|
| A1 | Sağ panel 380 px'i kaplıyor ama çoğu ekranda yalnız "Kanıt için bir öğe seçin" yazıyor. | Ekranın ~%27'si boş; liste daralıyor. |
| A2 | Disk'te seçim çubuğu **her zaman** görünür; `0 Planda · 0 B` ile başlıyor. | Kullanıcı "bir şey seçmeli miyim?" diye düşünüyor; eylem hiyerarşisi bulanık. |
| A3 | Genel Bakış dikey yığın: ölçü paneli + 4 defter + risk kartları + güvenli kazanımlar + kararlar. | Sayılar birbirinden kopuk; "şimdi ne yapmalıyım?" cevabı yok. |
| A4 | Tipografi düz: gövde 14, tablo 12.5, başlık 22; ağırlık farkı az. | Uzun oturumda yorucu; ürün değil "prototip" hissi. |
| A5 | Rail'de 10 eşit öğe ve altında büyük boşluk. | Bilgi mimarisi düz; gruplama yok. |
| A6 | Boş durumlar tek satır metin ("Bu ekran için işlem yok"). | Yeni kullanıcıya yol göstermiyor. |
| A7 | Tablo satırı sıkışık; başlık, yol ve rozetler aynı görsel ağırlıkta. | 100+ kümede tarama zor. |
| A8 | Ayarlar/Plan formları tek sütun geniş kartlar; bölüm başlıkları zayıf. | Form "kurumsal panel" değil, alt alta kutu gibi. |

---

## 3. Araştırma sentezi

İncelenen kaynaklar (desen düzeyinde; marka/kod kopyalanmadı):

- UXPin — dashboard tasarım ilkeleri: hiyerarşi, tek bakışta özet, gereksiz
  metrikten kaçınma. <https://www.uxpin.com/studio/blog/dashboard-design-principles/>
- Toptal — koyu arayüz ilkeleri: katmanlı yüzeyler, sınırlı vurgu rengi,
  negatif alan, kontrast. <https://www.toptal.com/designers/ui/dark-ui-design>
- PatternFly — primary-detail: liste + anlamlı boş denetçi, seçim bağlamı.
  <https://www.patternfly.org/patterns/primary-detail/>
- NN/g — progressive disclosure: ayrıntıyı istek üzerine göster.
  <https://www.nngroup.com/articles/progressive-disclosure/>
- Eleken — empty state: eylem odaklı boş durum, örnek/CTA.
  <https://www.eleken.co/blog-posts/empty-state-ux>
- SaaSUI — toplu eylem çubuğu yalnız seçim varken görünür.
  <https://www.saasui.design/>

Sentez (bu projeye uyarlanmış 8 kural):

1. **Tek bakışta cevap.** Her ekranın üstünde "ne oldu / ne yapmalıyım"
   cümlesi. Dashboard'da sayı + karar + eylem aynı blokta.
2. **Katmanlı koyu yüzey.** `bg` → `surface` → `raised` → `overlay`.
   Gölge yerine ince çizgi + ton farkı; vurgu rengi az.
3. **Anlamlı boş denetçi.** Sağ panel boşken "ne seçersen burada ne görürsün"
   akışını 3 adımda anlat; boş paneli boş bırakma.
4. **Bağlamsal toplu eylem.** Seçim/plan yokken çubuk görünmez; seçim
   başlayınca belirir, seçim bitince kaybolur.
5. **Eylem odaklı boş durum.** "Kayıt yok" değil, "Tara" / "Disk'e git" /
   "Örnek kök ekle" gibi bir sonraki adım.
6. **Ayrıntıyı istem üzerine aç.** Gelişmiş filtreler kapalı; satır detayı
   sağ panelde; risk kartları tıklanmaz, defter kartları açılır.
7. **Yoğun ama nefes alan tablo.** 14 px gövde, 13 px tablo, 44 px satır;
   başlık güçlü, yol soluk, sayı hizalı.
8. **Sessiz hareket.** 120–160 ms geçiş; `prefers-reduced-motion` hepsini
   kapatır. Skeleton yalnız ilk yüklemede.

---

## 4. Tasarım kararları

### 4.1 Belirteçler (P0)

| Belirteç | Değer | Kullanım |
|---|---|---|
| `--bg` | `#0a0e13` | sayfa |
| `--bg-soft` | `#0d131a` | kabuk / rail / panel |
| `--panel` | `#111923` | kart / liste yüzeyi |
| `--panel-2` | `#16202c` | hover / seçili |
| `--panel-3` | `#1b2734` | yükseltilmiş / aktif |
| `--line` | `#1e2b38` | ayırıcı |
| `--line-strong` | `#2a3a4b` | odak dışı vurgu |
| `--text` | `#e8eff7` | ana metin |
| `--dim` | `#93a3b8` | ikincil |
| `--faint` | `#7d8da4` | üçüncül / yol |
| `--accent` | `#46d17e` | güvenli / birincil |
| `--info` | `#63a9ff` | bilgi / odak |
| `--warn` | `#e5b143` | dikkat |
| `--danger` | `#ff6b6b` | risk |
| `--vault` | `#b795ff` | kasa |
| `--line-soft` | `#17212c` | tablo/satır ayırıcı (mevcut; ilk taslakta eksikti) |
| `--accent-dim` | `#1f6f34` | marka degrade + `tone-ok` kenarı (mevcut; eksikti) |

- Gövde **14 px / 1.5**; tablo **13 px**; `h1` **28 px / 1.15**, `h2`
  **15 px**, bölüm etiketi **11 px / 0.08em uppercase**.
- Sayılar `tabular-nums`; boyut/süre mono. Yarıçap: kontrol 8, kart 12,
  panel 14, rozet 999.
- Odak: 2 px `--info`, 2 px offset. Gölge yalnız overlay/dialog.

**Kontrast düzeltmesi (kod geri doğrulaması, 2. tur):** ilk taslakta
`--faint` değeri `#6f8096` idi; ölçüm: panel **4.38:1**, panel-2
**4.07:1** — 11 px yol/alt metin için AA sınırı 4.5:1'in ALTINDA.
Mevcut M5 değeri `#74839a` da panel-2'de 4.27 ile ihlaldi. Yeni değer
`#7d8da4`: panel **5.24** · panel-2 **4.87** · bg **5.73** — üç yüzeyde
geçer. (`--text/--dim/--accent/--warn/--danger` ölçümleri mevcut
değerlerden İYİ çıktı; dokunulmadı: bkz. §8 ölçüm tablosu.)

**İkincil belirteçler (Faz 0'da adlandırılır):**

| Grup | Belirteçler | Not |
|---|---|---|
| Boşluk | `--space-1..6` = 4 / 8 / 12 / 16 / 24 / 32 px | Faz 3 hizalama ölçeği |
| Yarıçap | `--r-sm` 8 · `--r-md` 12 · `--r-lg` 14 · `--r-pill` 999 | prozedürel değerlerin adı |
| Hareket | `--dur-fast` 120ms · `--dur` 150ms | `prefers-reduced-motion` genel kapatma korundu (styles.css 3294) |
| Zıplama | `--z-sticky` 1 · `--z-drawer` 30 · `--z-dialog` 40 · `--z-modal` 60 | bugünkü ad-hoc 1/20/30/40/60/70'in adlandırılması |
| Yazı | `--font-ui` · `--mono` (mevcut yığın) | `--mono` bugün :root'ta tanımlı |

### 4.2 Kabuk (P0)

- Topbar 56 px: marka · (esnek) · tarama durumu · bekleyen plan · eylemler.
  (Bugünkü `.app` satırı 54 px; 56'ya geçilirken 54'e bağlı iki sabit
  nokta birlikte taşınır: `<820px` çekmece `top: 54px` ve skip-link
  `top: -56px` — styles.css 56/459.)
- Rail **gruplu**: `Tara` (Genel Bakış, Disk, Plan) · `Sistem` (Projeler,
  Araçlar, PATH, Graf) · `Kayıt` (Zamanlanmış, Kasa) · altta `Ayarlar`.
  Grup etiketi 10 px uppercase; daraltınca yalnız ikon + ayırıcı çizgi.
- Rail altında **yerel çalışma notu**: kilit ikonu + "Veriler bilgisayarından
  çıkış yapmaz · güncelleme kontrolü yalnız izin verirsen" (TR/EN `i18n`).
  "Veri dışarı gitmez" mutlak ifadesi kullanılmaz: güncelleme kontrolü
  opt-in açılınca tek sürüm sorgusu yapılır (kural 15) — not bunu kesin
  söylemeli. Ürün vaadini hatırlatır, boşluğu anlamlı doldurur.
- Sağ panel boş `Kanıtlar`: ikon + başlık + 3 adımlı yol
  (satır seç → kanıtı oku → plana ekle) + "Disk'e git" bağlantısı.
  `İşlem` boş: "Bu ekranda işlem yok" + hangi ekranlarda olduğu.
- Sağ panel `Plan Durumu` boş: mevcut plan ikonu + "Disk'ten seç" CTA.

### 4.3 Genel Bakış (P1)

Yeni düzen:

1. **Page head:** başlık + alt cümle; sağda tarama damgası + "Disk'e git".
2. **Hero (tek panel):**
   - sol: `Geri kazanılabilir` etiketi, büyük mono sayı, "Taranan X" ve
     tarama durumu;
   - sağ: **karar dağılımı** yatay segmentli çubuk + 4 satır lejant
     (sayı + etiket). Toplam sıfırsa çubuk yerine boş durum cümlesi.
3. **Defter kartları:** 4 kart; her biri buton, `aria-pressed`, sayı + not.
4. **Dikkat kartları:** yalnız varsa; ton noktası + konu + sonuç + meta.
5. **Güvenli kazanımlar:** tablo; kategori rozeti, boyut, neden iki rozet.
   Boşsa eylem odaklı boş durum.
6. **Kararlar paneli kaldırılır** (hero'ya taşındı) — dikey yığın kısalır.
7. **Tarama yoksa:** hero yerine büyük boş durum + "Disk'e git" CTA.

### 4.4 Disk (P2)

- Sayfa başlığı + tarama rozeti + "Yeniden tara" tek satır.
- Araç çubuğu 2 satır: arama + tür sekmeleri + "Filtreler"; ikinci satır
  tarama seçenekleri (çipler). Gelişmiş filtreler kapalı.
- **Seçim çubuğu yalnız `plan > 0` veya `seçim > 0` iken** görünür.
  Yoksa ince bir ipucu satırı: "Henüz plan yok · satırdan seçin" +
  "Varsayılanları plana ekle" bağlantısı.
- Tablo: sticky başlık, 44 px satır, başlık 13.5/600, yol 11.5 mono faint,
  rozetler ayrı ton, boyut sağa hizalı ve güçlü.
- Boş liste: ikon + "Bu filtrede küme yok" + "Filtreleri temizle".
- Yükleniyor: 6 satır skeleton (shimmer, reduced-motion'da statik).

---

## 5. Faz listesi

> **Kural:** her faz ayrı oturumda kapanır. Bir faz "tamam" sayılmadan
> sonraki faza geçilmez. Her fazın sonunda `typecheck` + `test` + `build`
> + gerçek tarayıcı kapısı vardır. Kod taslağı hazır olmak, fazın kapandığı
> anlamına gelmez.

### Faz 0 — Temel (bu oturumun konusu)

| Kimlik | İş | Durum |
|---|---|---|
| UI-001 | Belirteçler + tipografi + yüzey katmanları | ✅ 25.10.2026 |
| UI-002 | Topbar + gruplu rail + yerel çalışma notu | ✅ 25.10.2026 |
| UI-003 | Sağ panel anlamlı boş durumlar | ✅ 25.10.2026 |

**UI-002 kabul detayları (kod doğrulamasından):** roving tabindex +
`↑ ↓ Home End` gruplama ile birebir çalışır (App.tsx 429-448, seçici
`.rail-item`); grup başlıkları `button` DEĞİL ve odak sırasına girmez;
`aria-current="page"` + `aria-label` davranışı korunur; `localStorage`
anahtarları aynen kalır: `residue.lang/rail/panel/panelWidth`
(App.tsx 313-328).

**Çıkış kapısı:** typecheck temiz · test sayısı korunur · build ·
`npm run smoke` (35 kontrol) · 1440/1024 tarayıcı · **tüm 10 ekranın**
süpürülmesi (belirteçler globaldir; unsız kalan ekran kırık görünmesin)
· ekran görüntüsü · tek commit. Dashboard ve Disk değişiklikleri bu faza
**dahil değildir**; Faz 1/2'ye aittir.

### Faz 1 — Genel Bakış

| Kimlik | İş | Durum |
|---|---|---|
| UI-004 | Genel Bakış hero + karar dağılımı | ✅ 25.10.2026 |
| UI-005 | Defter ve dikkat kartları cilası | ✅ 25.10.2026 |
| UI-006 | Güvenli kazanımlar tablosu + boş durum | ✅ 25.10.2026 |

**Çıkış kapısı:** hero sayıları motordan; segmentli çubuk yalnız görsel ve
`aria-hidden` — değerler yalnız lejant satırlarından okunur; defter kartı
tıklaması sağ panelde detay; tarama yoksa eylemli boş durum. Bu faz
"Kararlar paneli"ni kaldırarak UX-PLAN P8'i kapatır.

### Faz 2 — Disk akışı

| Kimlik | İş | Durum |
|---|---|---|
| UI-007 | Bağlamsal seçim çubuğu (plan/seçim yokken gizli) | ✅ 25.10.2026 |
| UI-008 | Tablo/araç çubuğu/skeleton/boş durum | ✅ 25.10.2026 |

**Çıkış kapısı:** seçim yokken çubuk yok; satır seçince çubuk var; plana
ekleme sayfadan ayrılmadan; sağ panelde `Planda` rozeti; filtre boşken
"Filtreleri temizle". Çubuk gizliyken "Varsayılanları plana ekle" ipucu
satırından erişilebilir kalır (bugün çubuk içinde, Disk.tsx 635-641); canlı
`sr-only` seçim duyurusu korunur (Disk.tsx 618).

### Faz 3 — Ortak ekran cilası

| Kimlik | İş | Durum |
|---|---|---|
| UI-009 | Projeler, Araçlar, PATH, Graf, Plan, Ayarlar, Kasa, Zamanlanmış için ortak başlık/panel/form/boş durum stilleri. Denetim listesi: `.advanced-wall` + `.badge.advanced` (Gelişmiş mod duvarı — tehlike tonu korunur) · `.signal-badge` (F5 kanıt rozetleri) · kasa `TASI`/`SIL` duvarları | ⬜ bekliyor |

**Çıkış kapısı:** tüm ekranlar yeni belirteçlerle tutarlı; hiçbir ekran
okunamaz/kırık değil; TR/EN taşması yok.

### Faz 4 — Ürün cilası ve kapanış

| Kimlik | İş | Durum |
|---|---|---|
| UI-010 | TR/EN metin denetimi + eksik anahtar kontrolü | ⬜ bekliyor |
| UI-011 | typecheck + test + build | ⬜ bekliyor |
| UI-012 | Gerçek tarayıcı doğrulaması (1440 + 1024) + devir notu | ⬜ bekliyor |

**Çıkış kapısı:** `npm test` yeşil; bundle üretilmiş; ekran görüntüleri
`scratch/ui-product-2026-10-25/after-*.png`; `SESSION_LOG.md` + `state.json`
güncel; tek commit.

### Bu oturumda yapılmayacaklar

- Projeler/Araçlar/Graf ekranlarına hero eklemek (Faz 3).
- Plan ekranında adım göstergesi, Ayarlar'da bölüm gezinmesi, komut paleti
  (Faz 4+).
- Hiçbir motor/API/onay kuralı değişikliği.


---

## 6. Doğrulama protokolü

1. `npm run typecheck` (src + web) temiz.
2. `npm test` — mevcut test sayısı korunur, düşmez.
3. `npm run build:web` — bundle üretilir.
4. Eski sunucu sürecini kapat, **önce derle, sonra sunucuyu başlat** (K15).
5. `ego-browser` ile 1440×900 ve 1024×768:
   - **Belirteç kapısı:** `--faint` metinleri panel ve panel-2 yüzeylerinde
     ≥ 4.5:1 (ölçümle); odak halkası yeni yüzeylerde görünür.
   - **Faz 0'da 10 ekranın tamamı** iki genişlikte süpürülür (belirteç
     değişimi globaldir);
   - Genel Bakış: hero sayıları, segmentli çubuk, defter kartı tıklaması,
     sağ panelde detay;
   - Disk: seçim yokken çubuk yok, satır seçince çubuk var, plana ekleme,
     sağ panel `Planda` rozeti;
   - TR/EN geçişi; konsol hatası yok.
6. Ekran görüntüleri `scratch/ui-product-2026-10-25/after-*.png`.
7. Sonuçlar `SESSION_LOG.md` + `state.json` içine yazılır.

---

## 7. Değişmezler (bu turda da geçerli)

- Arayüz **hesap yapmaz**: sayı, rozet, sıralama, plan kapsamı motordan gelir.
- Yeni metin anahtarları `web/src/i18n.ts` içinde TR + EN birlikte eklenir.
- `src/` altında uygulama adı geçmez; bu turda `src/` değişmez.
- Sağ panel bir "karar" yüzeyi değil, **kanıt ve plan görüntüleyicisi**dir.
- Hiçbir yeni düğme doğrudan silmez; en fazla plan üretir.
- `prefers-reduced-motion` ve klavye-only tur korunur.
- `GELİŞMİŞ` onay duvarı görsel karşılığıyla korunur (`.advanced-wall` +
  `.badge.advanced`, styles.css 3439-3463); yeni belirteçler yalnız ölçek
  bağlar, tehlike tonu değişmez.
- `npm run smoke` (35 kontrol) her faz çıkışında yeşil kalır.
- Rail/panel `localStorage` anahtarları ve kısayollar (`/`, `?`, ok
  tuşları, Esc) davranış birebir korunur.

---

## 8. İnceleme eki — kod karşısı doğrulama (25.10.2026, 2. tur)

**Iş:** bu belge ile çalışan depo (`web/`, 3464 satır CSS,
`App.tsx` 956 satır) satır bazında karşı okundu. Amaç: A1–A8'in bugün
hâlâ geçerli olup olmadığını ve haritanın kodca uygulanabilirliğini
kanıtla. Bulgular:

| İlk tur bulgusu | Kod kanıtı | Durum |
|---|---|---|
| A1 — sağ panel boşken tek cümle | `RightPanel.tsx` 139-141 (`rp-empty`, `p.dim`) | DOĞRU → UI-003 |
| A2 — seçim çubuğu her zaman görünür | `Disk.tsx` 617 (koşulsuz `.selection-bar`) | DOĞRU → UI-007 |
| A3 — Genel Bakış dikey yığın | `Dashboard.tsx` 136-313 (ölçü → defter → kart → güvenli kazanımlar → kararlar) | DOĞRU → UI-004..006 |
| A5 — rail 10 eşit öğe | `App.tsx` 50-61 (düz `NAV` listesi) | DOĞRU → UI-002 |
| A6 — yükleme tek satır | `App.tsx` 695 (`{loading && <div className="state">...`) | DOĞRU; uygulama iskeleti ayrı öneri (UI-013) |

**Sonradan gelen kapsam (haritaya işlendi):** Gelişmiş mod (A1/A2
commits, aynı gün, belgenin ilk derlemesinden önce koddaydı ama listede
yok): `.advanced-wall` (styles.css 3439-3457; `PlanScreen.tsx` 214,
`Settings.tsx` 207), `.badge.advanced` (styles.css 3459; `Disk.tsx`
769). Ayrıca T69/F5 `.signal-badge` (styles.css 1895). Üçü Faz 3
denetim listesine (UI-009) ve §7 değişmezlerine eklendi.

**Kontrast ölçümleri (WCAG 2.x, normal metin ≥ 4.5:1):**

| Çift (metin / yüzey) | taslak `--faint #6f8096` | `#7d8da4` (yeni) | eski `#74839a` |
|---|---|---|---|
| faint / panel | **4.38** ✗ | **5.24** ✓ | 4.60 ✓ |
| faint / panel-2 | **4.07** ✗ | **4.87** ✓ | **4.27** ✗ |
| faint / bg | 4.80 ✓ | 5.73 ✓ | 5.03 ✓ |

- Diğer taslak renkler ölçüldü ve KORUNDU: `text/panel` 15.26 ·
  `dim/panel` 6.88 · `accent/panel` 9.00 (eski 7.03) · `warn/panel`
  9.01 (eski 7.07) · `danger/panel` 6.37 (eski 5.32) · primary düğme
  metni/accent 9.75 — hepsi taslak paletle İYİLEŞTİ. Yalnız `--faint`
  klipler ve düzeltildi.
- `.advanced-wall` karışımları da geçer: danger metin / duvar zemin
  5.43 (eski palet 4.69).

**UI-013 — açık öneri (kullanıcı kararı bekliyor):** ilk yüklemede
tam-sayfa `Yükleniyor` yerine kabuk iskeleti (topbar/rail zaten çizili;
`main` içinde shimmer satırlar). Faz 2'nin Disk iskeleti bileşeni
yeniden kullanılır. Faz 0 listesine eklenmedi; onay gelirse Faz 1
sırasında değerlendirilir.

**Araştırma eki (sentete opsiyonel):** yüzey katmanı ölçeğinin (kural 2)
güncel uygulama karşılıkları: Radix Colors'ın 12 adımlı koyu ölçek
mantığı ve Material 3 "tonal elevation rolleri" (`surface-container*`).
PatternFly/NN/g kaynakları yeterli; bu iki desen yalnız token adlandırması
için referanstır, yeni bağımlılık GİRMEZ.

**Karar:** yol haritası faz listesi değişmedi (UI-001..UI-012 + açık
UI-013); Faz 0 hâlâ sıradaki iştir.

---

## 9. Faz 0 sonucu — 25.10.2026 (kapandı)

**Durum:** UI-001 · UI-002 · UI-003 ✅. Motor, servis, API ve onay
kuralları **değişmedi**; `src/` dokunulmadı.

| İş | Uygulama | Kanıt |
|---|---|---|
| UI-001 | `styles.css :root` yeniden yazıldı (`panel-3`, `line-strong`, `faint #7d8da4`, space/radius/duration/z ölçekleri, `--font-ui`, `--shadow`); gövde 14/1.5, `h1` 28/1.15, bölüm etiketi 11 px, `tabular-nums`; `.app` 56 px + çekmece/kısayol ripplesi | DOM ölçümü: `faint` panel 5.24 / panel-2 4.87 / bg 5.73; body `14px/21px`, h1 `28px/32.2px`, topbar `56px` |
| UI-002 | `NAV_GROUPS` (Çalışma · Sistem · Kayıt) + alta sabit Ayarlar + kilit ikonlu yerel not; `lock`/`arrowRight` ikonları | 3 grup, 10 öğe aynı sırada; daraltılmış rail 52 px, görünür etiket 0, Ayarlar dipte; roving tabindex/`aria-current`/localStorage aynı |
| UI-003 | `PanelEmpty` (`emptyKind` + `emptyAction`): Kanıtlar 3 adım + CTA, İşlem "hangi ekranlarda", Plan Durumu "Plan boş" + CTA | TR + EN metinleri ve CTA'lar gerçek tarayıcıda okundu |

**Kapılar:** typecheck (src + web) 0 · `npm test` 388/388 · `build:web`
133.41 kB gzip · `smoke` temiz · 1440/1024 + 760 çekmece taraması · konsol
hatası yok · ekran görüntüleri `scratch/ui-product-2026-10-25/after-*.png`.

**Kapsam dışı bırakılanlar (harita §5 gereği):** Genel Bakış hero/dikey
yığın (Faz 1), Disk seçim çubuğu/tablo (Faz 2), ekran içi boş durumlar ve
form cilası (Faz 3), tam-sayfa yükleme iskeleti (UI-013, kullanıcı kararı
bekliyor).

**Sıradaki:** **Faz 1 — UI-004..UI-006.**

---

## 10. Faz 1 sonucu — 25.10.2026 (kapandı)

**Durum:** UI-004 · UI-005 · UI-006 ✅. Motor/API/onay kuralı değişmedi;
`src/` dokunulmadı. `UX-PLAN P8` (Kararlar paneli) kapandı.

| İş | Uygulama | Kanıt (DOM) |
|---|---|---|
| UI-004 | `Dashboard.tsx`: sayfa başında tarama damgası + "Disk'e git"; tek **kahraman panel** (solda "Geri kazanılabilir" + 44 px mono sayı + "Taranan X" + tarama durumu noktası; sağda **karar dağılımı** çubuk + 2×2 lejant). Çubuk `aria-hidden`, değerler yalnız lejanttan. Toplam 0 ise çubuk yerine cümle. Tarama yoksa hero yerine **3 adımlı boş durum + CTA**. | hero `17.3 GB`; meta `Taranan: 48.1 GB · Tarama güncel`; lejant `10/89/6/0` (toplam 105); segment `flexGrow` 10/89/6; `verdict-grid` DOM'da **yok** |
| UI-005 | Defter kartları: 12 px yarıçap, üst harf etiketi, hover/aktif tonu (`aria-pressed` + iç çizgi). Dikkat kartları: vurgu çubuğu yerine **ton noktası**, 10 px iç boşluk, bölüm başlığı + motor sayısı. | defter tıklaması → sağ panel `KANITLAR`, başlık `GERİ KAZANILABİLİR İÇERİK`, `aria-pressed` doğru kartta; dikkat bölümü 2 kart |
| UI-006 | Güvenli kazanımlar: kategori **rozet**, boyut sağa hizalı, "neden" iki rozet (yeniden üretilebilir = yeşil ton). Boşsa **eylemli boş durum** (başlık + açıklama + "Disk'e git"). | 2 satır, rozetler; tarama yokken boş durum metni + CTA göründü |

**Boş durum doğrulaması:** ayrı veri dizini (`%TEMP%\residue-ui-empty`,
`scanOnLaunch=manual`) ile ikinci bir sunucu (4412) açıldı; Genel Bakış
**hero yerine** "Henüz tarama yok" + 3 adım + "Disk'e git" gösterdi; CTA
**Disk** ekranına gitti; güvenli kazanımlar boş durumu göründü. Sunucu ve
geçici dizin kapatıldı/silindi. Gerçek veri dizinine dokunulmadı.

**Kapılar:** typecheck (src + web) 0 · `npm test` **388/388** · `smoke`
temiz · `build:web` CSS 51.20 kB (9.33 gzip) / JS 473.55 kB (134.17 gzip) ·
1440 + 1024 (hero `285.2px 420px`, yatay taşma yok) · TR/EN · konsol
hatası yok. Ekran görüntüleri: `scratch/ui-product-2026-10-25/faz1-*.png`.

**Sıradaki:** **Faz 2 — UI-007..UI-008** (Disk: bağlamsal seçim çubuğu,
tablo/araç çubuğu/skeleton/boş durum).

---

## 11. Faz 2 sonucu — 25.10.2026 (kapandı)

**Durum:** UI-007 · UI-008 ✅. Motor/API/onay kuralı değişmedi.

| İş | Uygulama | Kanıt (DOM) |
|---|---|---|
| UI-007 | Plan/seçim yokken `.selection-bar` **hiç basılmaz**; yerine tek satır ipucu ("Henüz plan yok. Satırdan seçin veya varsayılanları ekleyin.") + **"Varsayılanları plana ekle"** ve "Görünenleri plana ekle" düğmeleri. Canlı `sr-only` duyuru **her zaman** yayında. Plan varken çubuk: solda **istatistik**, sağda **eylem** bloğu (dar ekranda eylemler kendi satırına sağa hizalı iner). | plan yokken `bar:false, hint:true`, duyuru "0 Planda · 0 B"; satır seçilince `bar:true`, istatistik/eylem `sameRow:false` + `actionsRightAligned:true` (78 px iki satır), satırda "Plana Eklendi" + `×`, sağ panel `PLAN DURUMU 1`; "Planı boşalt" sonrası `bar:false, hint:true` |
| UI-008 | Tablo: satır **44 px**, küme adı 13.5/600, yol 11.5 mono soluk, boyut sağa hizalı **600**, karar rozeti **tonlu** (Önerilen yeşil, Doğrulama sarı, Yalnız rapor mavi), başlık 11 px/0.08em. Yüklemede **6 satır iskelet** (shimmer, `aria-hidden` + `sr-only` "Yükleniyor"). Liste boşsa **eylemli boş durum**: tarama yoksa "Henüz tarama yok" + "Tara"; filtre boşsa "Bu filtrede küme yok" + **"Filtreleri temizle"** (tarama seçenekleri korunur). | satır `44`, başlık `13.5/600`, yol `11.5`, boyut `600`, rozet sınıfları `badge warn/ok`; ağ 2.5 s geciktirilince `skeleton` 6 satır + `sk-shimmer`; filtre boş `disk-empty` metni + temizle → 17 satır geri, arama `""`; 1024'te yatay taşma yok |
| Ek | Disk sağ paneli seçim yokken artık **kendi içeriğini basmaz**; panelin anlamlı boş durumu (UI-003) görünür — "Bir satır seçin" tekrarı kaldırıldı. | `panelTitle: "Kanıt burada görünür"`, eski `.disk-detail h2` yok |

**Kapılar:** typecheck (src + web) 0 · `npm test` **388/388** · `smoke` temiz ·
`build:web` CSS 53.20 kB (9.66 gzip) / JS 475.97 kB (134.62 gzip) ·
1440 + 1024 · TR/EN · ekran görüntüleri
`scratch/ui-product-2026-10-25/faz2-*.png`.

**Deney notu:** iskeleti görmek için `Network.emulateNetworkConditions`
(2.5 s gecikme) kullanıldı; ilk denemede `/api/disk` **engellenince** hata
bandı çıktı (iskelet değil) — doğru davranış, ama iskelet yalnız "hata yok +
veri yok" durumunda görünür.

**Sıradaki:** **Faz 3 — UI-009** (Projeler, Araçlar, PATH, Graf, Plan,
Ayarlar, Kasa, Zamanlanmış için ortak başlık/panel/form/boş durum stilleri;
`.advanced-wall`, `.badge.advanced`, `.signal-badge` denetimi).
