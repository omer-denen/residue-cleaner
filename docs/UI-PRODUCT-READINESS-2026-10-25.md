# Arayüz ürünleşme günlüğü — 25.10.2026

> **Durum:** yürürlükte. Bu dosya hem karar günlüğü hem de faz listesidir.
> **25.10.2026 ara durum:** Yol haritası onaylandı. Bu oturumda kod
> değişikliği bırakılmadı; Faz 0/1/2 denemeleri geri alındı ve yalnız
> `scratch/ui-product-2026-10-25/faz0-2-taslak.patch` (git dışı) olarak
> saklandı. Sıradaki oturum Faz 0'dır.
> **Kapsam:** web arayüzü (`web/`), görsel sistem ve ekran yerleşimleri.
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
| `--faint` | `#6f8096` | üçüncül / yol |
| `--accent` | `#46d17e` | güvenli / birincil |
| `--info` | `#63a9ff` | bilgi / odak |
| `--warn` | `#e5b143` | dikkat |
| `--danger` | `#ff6b6b` | risk |
| `--vault` | `#b795ff` | kasa |

- Gövde **14 px / 1.5**; tablo **13 px**; `h1` **28 px / 1.15**, `h2`
  **15 px**, bölüm etiketi **11 px / 0.08em uppercase**.
- Sayılar `tabular-nums`; boyut/süre mono. Yarıçap: kontrol 8, kart 12,
  panel 14, rozet 999.
- Odak: 2 px `--info`, 2 px offset. Gölge yalnız overlay/dialog.

### 4.2 Kabuk (P0)

- Topbar 56 px: marka · (esnek) · tarama durumu · bekleyen plan · eylemler.
- Rail **gruplu**: `Tara` (Genel Bakış, Disk, Plan) · `Sistem` (Projeler,
  Araçlar, PATH, Graf) · `Kayıt` (Zamanlanmış, Kasa) · altta `Ayarlar`.
  Grup etiketi 10 px uppercase; daraltınca yalnız ikon + ayırıcı çizgi.
- Rail altında **yerel çalışma notu**: kilit ikonu + "Yerel çalışır ·
  veri dışarı gitmez". Ürün vaadini hatırlatır, boşluğu anlamlı doldurur.
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
| UI-001 | Belirteçler + tipografi + yüzey katmanları | ⬜ bekliyor |
| UI-002 | Topbar + gruplu rail + yerel çalışma notu | ⬜ bekliyor |
| UI-003 | Sağ panel anlamlı boş durumlar | ⬜ bekliyor |

**Çıkış kapısı:** typecheck temiz · build · 1440/1024 tarayıcı · ekran
görüntüsü · tek commit. Dashboard ve Disk değişiklikleri bu faza **dahil
değildir**; Faz 1/2'ye aittir.

### Faz 1 — Genel Bakış

| Kimlik | İş | Durum |
|---|---|---|
| UI-004 | Genel Bakış hero + karar dağılımı | ⬜ bekliyor |
| UI-005 | Defter ve dikkat kartları cilası | ⬜ bekliyor |
| UI-006 | Güvenli kazanımlar tablosu + boş durum | ⬜ bekliyor |

**Çıkış kapısı:** hero sayıları motordan; segmentli çubuk yalnız görsel;
defter kartı tıklaması sağ panelde detay; tarama yoksa eylemli boş durum.

### Faz 2 — Disk akışı

| Kimlik | İş | Durum |
|---|---|---|
| UI-007 | Bağlamsal seçim çubuğu (plan/seçim yokken gizli) | ⬜ bekliyor |
| UI-008 | Tablo/araç çubuğu/skeleton/boş durum | ⬜ bekliyor |

**Çıkış kapısı:** seçim yokken çubuk yok; satır seçince çubuk var; plana
ekleme sayfadan ayrılmadan; sağ panelde `Planda` rozeti; filtre boşken
"Filtreleri temizle".

### Faz 3 — Ortak ekran cilası

| Kimlik | İş | Durum |
|---|---|---|
| UI-009 | Projeler, Araçlar, PATH, Graf, Plan, Ayarlar, Kasa, Zamanlanmış için ortak başlık/panel/form/boş durum stilleri | ⬜ bekliyor |

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
