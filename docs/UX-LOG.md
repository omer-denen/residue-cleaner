# UX LOG — Kullanıcı Deneyimi Denetim Kaydı

> Bu dosya **kullanıcı deneyimi (UX) ve şeffaflık** bulgularının kaydıdır.
> Her bulgu bir **sınıfa** (aşağıdaki S1..S6) ve bir **kimliğe** (`UX-0xx`) sahiptir.
>
> **Kural:** Bulgu kaydı bir *fikir* değil, **ölçülmüş gerçektir**.
> Her madde "belirti / kanıt / öneri / durum" dörtlüsünü taşır.
> Durum: `acik` · `düzeltildi` · `reddedildi` (gerekçesiyle).
>
> **Mimari kural (AGENTS.md 18):** Bu logdaki her düzeltme **motorda** yapılır
> (`src/core/*`). Web (`web/src`) yalnızca motordan gelen kimliği metne çevirip
> basar; kendi kararını üretmez. "Hesap web'de" olan bir düzeltme **reddedilir**.

---

## Denetim kapsamı

- **Tarih:** 21.10.2026
- **Yöntem:** Gerçek tarayıcı (`ego-browser`, Edge/Chromium), `residue ui --web`
  (127.0.0.1:4411), canlı veri (108 küme / 610.392 dosya / 280 GB disk).
- **Bakılan açı:** İlk defa açan bir kullanıcı; uygulamanın arka planda ne
  yaptığını ve ekrandaki sayıların neye dayandığını anlayabilir mi?
- **Ekran sırası:** Genel Bakış → Disk → Plan → Projeler → Araçlar → PATH & Ortam
  → Graf → Planlar → Kasa → Ayarlar.

---

## Sınıflar

| Sınıf | Ad | Tanım |
|---|---|---|
| **S1** | Şeffaflık | Uygulamanın neyi bildiği, arka planda ne olduğu, sayıların neye dayandığı belli mi? |
| **S2** | Anlaşılabilirlik | Etiketler, terminoloji, belirsiz ifadeler, yanlış beklenti |
| **S3** | Veri sunumu | Payda, `0`/`bilinmiyor` ayrımı, ham kimlikler, kesilmiş metin |
| **S4** | Eylem | Tıklanabilirlik, çağrı (CTA), boşluk, ölü alan |
| **S5** | Mizanpaj | Hizalama, sarma, hiyerarşi, ekran dağılımı |
| **S6** | Erişilebilirlik | Klavye, odak, kontrast, ekran okuyucu |

---

## S1 · Şeffaflık

### UX-003 · Genel Bakış · Arka planda ne olduğu belli değil — `acik`
**Belirti:** Ekran "Tarama eski · 8 saat önce" diyor ama taramanın ne yaptığını,
neyi taradığını, diskten ne kadar okuduğunu söylemiyor. Kullanıcının
"benden habersiz bir şey silinir mi?" sorusu cevapsız.

**Kanıt (API'de var, ekranda yok):**
| Veri | Değer | Ekranda |
|---|---|---|
| `scan.status.disk.totalBytes` | 280 GB | yok |
| `scan.status.disk.usedRatio` | %57 | yok |
| `scan.status.dirty` | `true` | yok |
| `schedules` | `[]` (hiçbir şey otomatik değil) | yok |
| `settings.updateCheck` | `off` (ağ isteği yok) | yok |

**Öneri:** Tarama durumu tek bir yerde (rozet + ayrıntı raporu) toplanmalı;
"arkada ne çalışıyor" sorusu bir raporla cevaplanmalı.

### UX-012 · Genel Bakış · "Korunan" sayısı yanlış anlaşılıyor — `acik`
**Belirti:** "Korunan 26.9 GB" kullanıcıya "26.9 GB verim var" gibi okunuyor.
**Kanıt:** `dashboard-summary.ts:97` — `protected = totalBytes - reclaimableBytes`,
yani **taranan klasörlerin toplamı**, kullanıcının gerçek verisi değil.
Kod yorumu bunu biliyor ("sizin veriniz iddiası"), arayüz bildirmiyor.

**Öneri:** Etiket veya alt metin, sayının kapsamını açıklasın.

---

## S2 · Anlaşılabilirlik

### UX-001 · Tüm ekranlar · "Eski" rozeti anlamsız, pasif ve detaysız — `düzeltildi`
**Belirti:** Rozette tek başına **"Eski"** yazıyor. Neyin eski olduğu belirsiz
(tarama mı, veri mi, disk mi). Kullanıcı "biraz eski bilgi, sorun değil" diye
okuyup geçiyor.

**Kanıt:** `scan-service.ts:184-193` — `state = dirty || expired ? 'stale' : 'current'`.
Bu makinede `ageMs = 7,9 saat`, `ttlMs = 24 saat` → **`expired = false`**;
`dirty = true` (`dirty.json` — son temizlikten sonra disk değişti).
Yani rozet **"eski" olduğu için değil, "disk değişti" olduğu için** uyarı veriyor.
Üstelik rozet **amber** (dikkat), sözcük ise **"sorun değil"** çağrışımı yapıyor.

`dirty` kaynakları: `commands/clean.ts:187`, `web/server.ts:762`,
`services/schedule-service.ts:241` — yani **kullanıcının kendi geçmiş eylemi.**

**Çözüm — motor tarafında (arayüz karar vermez):**

- **Yeni motor:** `src/core/scan-status-view.ts` → `ScanStatusView` sınıfı.
  `ScanFreshness` ("stale") iki sebebi birleştiriyordu; motor artık
  `never | current | expired | dirty | dirty-expired | scanning` ayrımını yapıyor.
  `dirty` ve `expired` **ayrı sebepler** olarak raporlanıyor; ikisi birlikteyse
  `dirty-expired` (ton: `danger`).
- **Sözleşme:** `ScanStatusViewResponse` (kind, tone, reasons[], rows[],
  action, showAge) + `ScanStatusFacts`/`ScanStatusResponse`.
  `rows[]` satırları **değer türünü de motor seçer** (`timestamp | duration |
  bytes | count | ratio | text`) — arayüz yalnızca biçimlendirir.
- **Rozet:** artık `<button>` (`aria-haspopup="dialog"`, `aria-label="Tarama
  durumu: Disk değişti"`). Etiketler:
  `Tarama yok` · `Tarama güncel` · `Tarama eski` · `Disk değişti` ·
  `Tarama geçersiz` · `Taranıyor` (EN karşılıklarıyla).
- **Ayrıntı raporu (diyalog):** durum · **neden(ler)** · son tarama · tarama
  yaşı · önbellek süresi · önerilen tarama · taranan küme · sürücü · disk
  toplamı · boş alan · doluluk · **"Yeniden tara"** eylemi.
  Odak tuzağı var; `Esc` kapatır ve odağı rozete döndürür.
- **Tutarlılık:** Genel Bakış'taki risk kartı artık `scan-stale` değil
  `scan-dirty` → etiket "Disk değişti", ton `danger`.

**Doğrulama:**
- `tests/scan-status-view.test.ts` — 9 test (her hal için kind/tone/reasons/action).
- `npm test` → **107/107**; `npm run typecheck` temiz.
- Gerçek tarayıcı (Edge/Chromium, ego-browser):
  rozet `<button>` + `cursor:pointer` + `aria-haspopup="dialog"` ·
  diyalog `role="dialog" aria-modal="true"` · odak "Kapat"ta ·
  `Esc` → kapanır, odak rozete döner · Tab tuzağı çalışır ·
  TR/EN çevirileri tam · `dl` yapısı `dt/dd` (a11y ağacı doğru) ·
  konsol hatası yok.

### UX-014 · Tüm · İlk açılışta yönlendirme yok — `acik`
**Belirti:** `web/src` içinde onboarding / welcome / first-run **yok**
(grep: `welcome|onboarding|firstRun|intro` → eşleşme yok). Kullanıcı ilk
sayfada ne yapacağını, uygulamanın ne olduğunu öğrenemiyor.

**Öneri:** İlk çalıştırmada kısa bir "ne olacak" akışı (tercihen motor
kararına bağlı: `scan.state === 'never'` ise).

### UX-015 · Genel Bakış · "Yenile" yanlış beklenti yaratıyor — `acik`
**Belirti:** Topbar'daki "Yenile" yalnızca `/api/dashboard` + `/api/meta` +
`/api/scan/status` çağırıyor; **tarama tetiklemiyor**. Tarama için Disk
ekranındaki "Yeniden tara" gerekiyor.

**Kanıt:** `App.tsx` `load()` — `api.dashboard() / api.meta() / api.scanStatus()`.

**Öneri:** Etiket "Özeti yenile" olsun veya tarama tetikleyecek şekilde
ayrıştırılsın; rozet "Disk değişti"yken "Yenile" yanıltıcıdır.

### UX-016 · Tüm · Tanımsız terimler — `acik`
**Belirti:** "defter", "kasa", "güven yüksek/orta", "yeniden üretilebilir",
"rapor", "korumunuyor" — ilk kullanıcı için hiçbiri tanımlı değil.
"Kasa"nın Windows Geri Dönüşüm Kutusu mu kendi klasörü mü olduğu belirsiz.

### UX-017 · Disk · "seçili" iki kez yazıyor — `acik`
**Belirti:** Seçim çubuğu "**6 seçili** · **seçili boyut**: 5.5 GB · 6 hedef" →
ekranda "seçili" iki kez görünüyor.

**Kanıt (ölçüldü):** `SELECTION BAR: 6 seçili · 5.5 GB6 seçiliseçili boyut: 5.5 GB6 hedef…`
`i18n.ts:123` `'disk.selected': 'seçili'`, `i18n.ts:124`
`'disk.selection.bytes': 'seçili boyut'`.

**Öneri:** `disk.selection.bytes` → "boyut" / "size" (TR'de tekrar eden
"seçili" düşmeli). Aynı zamanda `sr-only` canlı bölge görünür metni
tekrar ediyor — ekran okuyucu iki kez duyuyor.

### UX-019 · Disk · Etiketsiz profil açılır listesi — `acik`
**Belirti:** Ortam çiplerinin yanındaki açılır liste yalnızca "—" gösteriyor,
etiketi yok. Neyi seçtiğini anlamak imkânsız.
**Kanıt:** `Disk.tsx:309-321` — `<select className="control" value={profile}>`,
`aria-label` var ama görünür etiket yok.

### UX-022 · Disk · "KANIT" başlığı içeriği yansıtmıyor — `acik`
**Belirti:** Sağ panel başlığı "KANIT"; içinde risk, karar, hedefler, parçalar,
kanıt işaretleri ve gerekçe var. Başlık, panelin en önemli kısmını (karar +
gerekçe) gizliyor.

---

## S3 · Veri sunumu

### UX-002 · Genel Bakış · "Araçlarda 0 B" aslında "bilinmiyor" — `acik`
**Belirti:** API `cli` defterinde **4.025.009.588 bayt** döndürüyor; ekran
**"Araçlarda 0 B"** diyor.

**Kanıt:** `dashboard-service.ts:57` — `const inv = this.inventory.getLast();`
Envanter **tetiklenmiyor**; ilk açılışta yok → `cliBytes = 0`.
`dashboard-summary.ts:101` — `{ id: 'cli', bytes: inv?.cliBytes ?? 0 }`.
Tarayıcıda ölçüldü: `API LEDGERS: cli → 4025009588`, `DOM: "Araçlarda" → "0 B"`.

**Sonuç:** Kullanıcı "kurulu CLI aracım yok" diye okuyor; gerçekte 3.7 GB
kurulu araç var. `0` ile `bilinmiyor`ın hiçbir görsel/semantik ayrımı yok.

**Öneri:** Envanter yoksa `0` yerine **"bilinmiyor"** gösterilmeli ve
"Araçlar" ekranına giden bir eylem sunulmalı.

### UX-004 · Genel Bakış · Sayıların paydası yok — `acik`
**Belirti:** "Geri kazanılabilir 26.8 GB" — 26.8 GB neyin? Diskte kullanılan
172 GB'nin %15.6'sı. Oran ekranda hiç yok → "az mı, çok mu?" cevapsız.
**Kanıt:** `scan.status.disk` → `totalBytes 301.203.451.904`,
`freeBytes 129.563.222.016`, `usedRatio 0.57` — veri var, kullanılmıyor.

### UX-013 · Genel Bakış · Ham kimlikler gösteriliyor — `düzeltildi`
**Belirti:** "GÜVENLİ KAZANIMLAR" tablosunda küme adı `local:dir:rattler`,
`local:dir:@opencode-aidesktop-updater`. Disk ekranında aynı küme
**"rattler — paket indirme önbelleği"** olarak görünüyor.

**Kanıt:** `Dashboard.tsx:129` — `<td className="mono">{win.clusterKey}</td>`.
`contract.ts:873` — `DashboardSafeWinView` yalnızca `clusterKey` taşıyor.

**Çözüm:** Motor `title` alanını doldurur (`c.title`); tablo başlıkta okunabilir
adı, altında ham anahtarı gösterir. Ham anahtar ikincil bilgi olarak kalır
(hata ayıklama/kesin adres için).

### UX-021 · Disk · Küme başlığı ve yol kesiliyor — `acik`
**Belirti:** "runt-nightly — Python/Node orta…" başlık kesiliyor; yol
"C:\Users\Code\AppData\Local\run…" kesiliyor.

**Kanıt (ölçüldü):** `cluster-title` `scrollW 238 / clientW 199`,
`cluster-path` `scrollW 246 / clientW 199`.

---

## S4 · Eylem

### UX-005 · Genel Bakış · Tabloda eylem yok — `acik`
**Belirti:** "GÜVENLİ KAZANIMLAR" tablosu 5 kazanç (~5.6 GB) gösteriyor ama
**hiçbir buton yok**. Doğal sonraki adım "bunları plana al"; kullanıcı bunu
Disk ekranında aynı kümeleri yeniden seçerek yapmak zorunda.

### UX-006 · Genel Bakış · Risk kartları tıklanabilir değil — `acik`
**Belirti:** Kartlar `<article>`, `cursor: auto`, `role`/`tabindex` yok.
Ama sözleşmede **hedef alanı zaten var** (`DashboardCardView.target`:
`disk`/`env`/`tools`/…). Niyet "tıkla ve oraya git" idi, uygulanmamış.

**Kanıt (ölçüldü):** `CARD INTERACTIVE: [{"tag":"ARTICLE","onClick":false,
"role":null,"tabIndex":null,"cursor":"auto"} × 3]`

### UX-007 · Genel Bakış · "Tarama eski" kartı sayısız ve eylemsiz — `acik`
**Belirti:** `count: 0` olduğu için sayı gizleniyor; kart ne kadar, ne
yapmalı, nereye — hiçbir bilgi vermiyor. `UX-001` ile aynı yüzey.

---

## S5 · Mizanpaj

### UX-027 · Genel Bakış · Risk kartlarının içeriği ortalanmıyor — `düzeltildi`
**Belirti:** "Disk değişti" kartının içeriği kartın üstüne yapışık, altında
büyük boşluk var; yanındaki "PATH sorunu" kartının etiketi 2 satıra, "Gölgede
kalan komut" 3 satıra sarıyor. Sayı ve hedef etiketi karttan karta kayıyor.

**Kanıt (ölçüldü):** `.card` `align-items: baseline` (tek satır flex).
`labelH` = 18.1 / 36.3 / 54.4 px (1 / 2 / 3 satır). Kart yükseklikleri eşit
(76 px) ama içerik dikeyde ortalanmıyordu.
**Sebep:** `.card-label { flex: 1 }` ama `min-width: 0` yok → uzun etiketler
eziliyor; hedef etiketi etiketi sıkıştırıp sağa itiyordu.

**Çözüm:** Kart 3 satırlık ızgaraya çevrildi —
`"accent label count" / "accent target target"`; `align-items: center` ile
içerik dikeyde ortalanıyor, `min-width: 0` ile etiket ezilmiyor, sayı sütunu
sabit (`min-width: 2.4ch`) ve **her kartta var** (sayı taşımayan kartlarda
`count: null` → motor kararı → "-"). Hedef etiketi ikinci satıra, sağa hizalı.

**Doğrulama (ölçüldü):** üç kart da **180×73 px**; etiket/sayı/hedef
konumları karttan karta **23 px** farkla aynı.

### UX-009 · Genel Bakış · Kart içi metin sarması tutarsız — `düzeltildi`
**Belirti:** Aynı satırdaki kartlarda etiket 1 / 2 / 3 satıra sarıyor.
**Kanıt (ölçüldü):** `labelH` = 18.1 / 36.3 / 54.4 px.
**Sebep:** `.card-label { flex: 1 }` ama `min-width: 0` yok → kısa etiketler
rahat, uzunlar eziliyor.
**Çözüm:** UX-027 ile birlikte çözüldü (ızgara + `min-width: 0`); etiket artık
kendi satırında tam genişlik alır.

### UX-008 · Genel Bakış · Risk kartı ızgarasında ölü alan — `acik`
**Belirti:** `repeat(auto-fill, minmax(180px, 1fr))` → 5 sütun açılıyor,
3 kart doluyor; sağda ~360 px boş.
**Kanıt (ölçüldü):** `gridCols: "180.15px ×5"`, `gridW: 933`, 3 kart dolu.

### UX-010 · Genel Bakış · "KARARLAR" paneli ekranın altında — `acik`
**Belirti:** En açıklayıcı veri katlanmış durumda.
**Kanıt (ölçüldü):** `verdictPanelTop 638.5`, `innerH 694`.
**İçerik:** 108 kümenin **12'si önerilen, 89'u "sor", 7'si rapor, 0'ı korunuyor.**

### UX-011 · Genel Bakış · Aynı rozet iki kez — `acik`
**Kanıt (ölçüldü):** `topChip: "Eski"`, `pageChip: "Eski · 8 saat önce"`.

### UX-018 · Disk · "SON KULLANILMA" başlığı iki satıra sarıyor — `acik`
**Kanıt (görsel):** Disk sütun başlıkları `26px 12px 1fr 104px 112px 86px 76px 62px`;
"SON KULLANILMA" 76 px sütuna sığmıyor.

### UX-023 · Disk · Başlıksız son sütun — `acik`
**Belirti:** En sağdaki sütun hedef sayısını gösteriyor ama başlığı boş.

### UX-020 · Disk · İç içe kaydırma — `acik`
**Belirti:** Sayfa kaydırması + liste kaydırması birlikte. Liste alanı
ölçüldü: `clientH 359` (viewport 694) — çok kısa bir iç kaydırma alanı.

### UX-025 · Disk · Küçük pencerede "BOYUT" sütunu sarması — `acik`
**Kanıt (908 px'te ölçüldü):** `BOYUT` hücresi 58.9 px → "2.6 GB" iki satıra
bölünüyor, satır yüksekliği 52.5 px'e çıkıyor.

---

## S6 · Erişilebilirlik

### UX-026 · Tüm · Rozetler buton değil — `acik`
**Belirti:** Tarama rozeti, risk kartları etkileşimli görünmüyor (`cursor:auto`)
ama bilgi taşıyorlar. `UX-001` ile kısmen çözüldü.

---

## S7 · Düzen (layout)

### UX-028 · Sol menü · Geniş ekranda yer kaplıyordu — `düzeltildi`
**Belirti:** Sol menü sabit 208 px; ikonu yok, tıklanabilir bir bütün olarak
208 px yer kaplıyordu. Kullanıcı: *"sol menü iconlu hamburger menü olsun, oradan
yer kazanalım, gizlendiğinde iconlar görünsün sadey"*.

**Çözüm:**
- `web/src/components/icons.tsx` **(yeni)** — 12 inline SVG ikon (bağımlılık yok,
  `currentColor` ile renk devralır). `menu`/`close` dahil.
- Menü öğesi: `<Icon/>` + `<span class="rail-label">`. **Hamburger** düğmesi
  üst çubukta (`aria-expanded`, `aria-controls="app-rail"`).
- **Daraltılmış mod** (geniş ekran): menü 208 px → **52 px**, etiketler gizli,
  yalnız ikonlar; durum `localStorage`'da (`residue.rail`).
- **Dar ekran (≤820px)**: menü **otomatik gizli** (ekran dışı, `translateX(-100%)`),
  hamburger ile **açılır panel** olarak gelir; arkasında karartma perdesi var.
  Bir ekrana girilince panel kapanır.
- Düğme etiketi **yaptığı işi** anlatır: daraltılmışken "Menüyü aç",
  açıkken "Menüyü kapat", geniş ekranda "Menüyü daralt".

**Doğrulama (ölçüldü):** daraltılmış → `cols: "52px 1152px 320px"`, `railW 52`,
`labelDisplay: none`, 10 ikon görünür, `localStorage: "collapsed"`.
Dar ekran (700px) → kapalı: `railX -220`, `aria-expanded false`;
açık: `railX 0`, `aria-expanded true`.

---

## S8 · Kullanici geri bildirimi (22.10.2026) — UYGULANDI

> Bu bölümdeki maddeler **kullanıcının kendi ifadeleriyle** kaydedilmiştir.
> **22.10.2026 ikinci turda 038–041 uygulandı**, 042 korundu, 043 kural
> olarak AGENTS.md'ye eklendi. Kanıtlar gerçek tarayıcıdaki DOM ölçümleridir.

### UX-038 · "Önceki Tarama" kartının içine tarama tarihi + geçen zaman — `düzeltildi`
> *"Önceki Tarama yazan kartın içine tarama yapılan tarihi ekliyorsun. ve
> geçen zamanı ekliyorsun."*

**Uygulama:** `DashboardCardView.meta` (motor: `scan.at` + `scan.ageMs`);
tarama kartında iki satır: tarih ve geçen süre.
**Ölçüm:** `21 Eki 2026 14:54` / `1 gün önce`.

### UX-039 · "Disk değişti" yazan her yer silinecek — `düzeltildi`
> *"diğer disk değişti yazan heryeri siliyorsun."*

**Uygulama:** üst çubuk rozeti artık **zaman** gösteriyor; Dashboard sayfa
başındaki statik rozet kaldırıldı; tarama raporu diyalogundaki durum satırı
kaldırıldı. Metin yalnızca **"Önceki Tarama" kartında** kaldı.
**Ölçüm:** DOM'da tam `Disk değişti` metni **1 kez**, yalnız
`.card-state`; `.page-head .scan-chip` = 0.

### UX-040 · Üst çubuk "Son Tarama: <geçen süre>" olacak — `düzeltildi`
> *"en üstteki header kısmında Son Tarama : geçen süre olarak kalsın."*

**Uygulama:** `ScanStatusViewResponse.header` (`none | age | scanning`);
hangi metnin gösterileceğine motor karar veriyor. Üst çubuk:
**"Son Tarama: 1 gün önce"**. Diyalog hâlâ açılır (Esc odağı rozete döndürür).

### UX-041 · "Ortam yolları" ve "Komut yolu" kartlarının içeriği bozuk — `düzeltildi`
> *"Ortam yolları kart içeriği bozuk komut yolu aynı şekilde."*

**Uygulama:** `.card-summary` sayı + sonucu tek satırda birleştirir
(`white-space: nowrap`); hedef ekran birinci satıra taşındı.
**Ölçüm:** `3 Yol sorunu` ve `30 Gölgede kalan komut`; üç kart da **88 px**
yüksekliğinde, `scrollWidth = clientWidth = 148` (taşma/sarma yok).

### UX-042 · Alt risk kartlarının tıklanabilirliği kalıyor — `düzeltildi`
> *"ben üstteki kartlardan bahsediyordum en alttaki kartları tıklanabilir
> yapmışsın. Tamam onlarda kalsın."*

**Durum:** ✅ **yapıldı ve kalıyor.** "üstteki" ile kastedilen üst çubuk ve
sayfa başı rozetleriydi; alt risk kartlarının tıklanabilirliği istenen şeydi
(UX-034) ve uygulandı.

**28.10.2026 — kullanıcı onayı:** kullanıcı, maddenin **önceki yeniden tasarım
fazında başka bir yöntemle çözüldüğünü** bildirdi ve **açık işlerden
çıkarılmasını onayladı**. Yöntem: defter kartları `<button aria-pressed>` +
alt detay listesi (UX-034/UX-044; motor `src/core/dashboard-details.ts`,
`web/src/screens/Dashboard.tsx:252-253`) ve detayın sağ panel **Kanıtlar**
modülüne taşınması (UX-045; `web/src/panel-plan.ts:60` →
`dashboard: { modules: ['evidence','planned','context'] }`). Risk kartları
statik `<article>` kalır. Bu madde artık açık iş değildir.

### UX-043 · "Yaptım" denip yapılmayan iş — süreç düzeltmesi — `düzeltildi`
> *"Ama bu değişiklikleri yaptıp deyipte yapmaman bu olmadı."*

**Uygulama:** AGENTS.md **kural 20** eklendi (belirsiz ifade önce sorulur;
kısmi iş "düzeltildi" diye raporlanmaz). Bu turda 038–041'in **tamamı**
uygulanmadan hiçbiri "düzeltildi" olarak işaretlenmedi; her madde ölçümle
doğrulandı.

### UX-044 · Genel Bakış · Tıklanabilir kartlar yanlış kümeydi — `düzeltildi`
> *"Önceki Tarama, ortam yolları, komut yolu kartları'nın içerikleri hizalanacak,
> Korunan, Geri kazanılabilir, Kasa, Araçlarda kartlarına tıklama atayalım,
> içerikler alt kısımda listelensin istedim. O da tam tersini yaptı."*

**Uygulama:** Risk kartları (Önceki Tarama, Ortam yolları, Komut yolu) statik
`<article>`; **defter kartları** (Korunan, Geri kazanılabilir, Kasada,
Araçlarda) `<button aria-pressed>` ve detayları `ledger-protected`,
`ledger-reclaimable`, `ledger-vault`, `ledger-cli` altında açılıyor.
Risk kartları 3 satırlık sabit ızgarada hizalandı: başlık y=293, özet y=313,
hedef/meta y=337; üçü de 183×88 px. "Araçlarda" envanter yoksa **bilinmiyor**
+ "Envanter taranmadı"; envanter taraması bitince dashboard tazelenir.

**S8 durumu:** 8/8 kapandı (038–042, 044, 045 düzeltildi; 043 kural olarak eklendi).

### UX-045 · Tüm ekranlar · Sağ panel yalnız Dashboard'da ve statikti — `düzeltildi`
> *"Sadece kanıtlar detayları değil, sağ içeriği daha dinamik kullanmak istiyorum.
> Diğer menülerde de aynı şekilde aktif olarak kullanmak lazım."*

**Araştırma (uygulama desenleri):** Office task pane (sabit sağ yüzey, ~320px,
katlanır), VS Code sidebar (3–5 modül), Figma properties (seçim sürücülü içerik),
Azure DevOps panel (listeden çıkmadan detay/eylem).

**Uygulama:** `web/src/components/RightPanel.tsx` — ekranlardan bağımsız modül
kabığı. Modüller: **Kanıtlar**, **İşlem**, **Planlananlar**, **Bağlam**.
Ekran asideleri portal ile panelde: Disk/Tools/Projects/Graph/Env; Dashboard
defter detayı Kanıtlar modülünde. `GET /api/plan` **salt okunur**; Planlananlar
satır çıkarma Plan ekranındaki **aynı motoru** kullanır, onay Plan'da kalır.
Panel varsayılan açık + katlanır (`localStorage`); 1180px altında gizli.

**Doğrulama:** Gerçek tarayıcıda dashboard kanıtı 80 satır; Disk küme kanıtı;
Tools SIL planı İşlem sekmesinde; Planlananlar 7→6 çıkarma; EN/TR ve klavye
okları; panel katla/aç. Test **123/123**.

---

## Durum özeti

| Durum | Adet | Maddeler |
|---|---|---|
| `düzeltildi` | 18 | UX-001, UX-009, UX-013, UX-027, UX-028, UX-032..036, UX-038..045 |
| `planlandi` | 4 | UX-029, UX-030, UX-031, UX-037 |
| `acik` | 22 | kalanlar |
| `reddedildi` | 0 | — |

**Planlanan işlerin tamamı:** `docs/UX-PLAN-2026-10-21.md` (P1..P8).
Kullanıcı kararı (21.10.2026): *"hemen yapamayız, plana ekle"*.

### UX-029 · Genel Bakış · "Güvenli Kazanımlar" çıkmaz yol — `planlandi`
**Belirti:** Tablo 5 kazanç (~5.6 GB) gösteriyor ama **hiçbir düğme yok**.
Kullanıcı cevabı: *"örneğin Planla => ve bu planı Planlar içerisine aktarma,
tarihli bir kayıt tutma gibi"* + *"Tarihli kayıt + hemen onaya"*.
**Plan:** `docs/UX-PLAN-2026-10-21.md` → **P2**.

### UX-030 · Sol menü · Plan sayısı rozeti yok — `planlandi`
**Belirti:** Kullanıcı: *"eğer plan var ise soldaki Plan menüsüne kaç plan var
ise badge verilmeli"*. Rozet sayısı **motor** verecek.
**Plan:** `docs/UX-PLAN-2026-10-21.md` → **P3** (IA seçimi kullanıcıda:
A tek "Planlar" / B yeniden adlandır / C olduğu gibi).

### UX-031 · Sağ panel · Katlanamıyor, boyutu ayarlanamıyor, içeriği sabit — `planlandi`
**Belirti:** Kullanıcı: *"en sağdaki içerik gösteren kısmın otomatik gizlene
bilir özelliği eklenmeli ve açılmalı… sadece kanıt detayları ile harcamak
istemiyorum. Diğer bazı içerikler de eklemek istiyorum. ortadan bir split
atarak"* + *"özelleştilebilir bir sağ panel menüsü olacak"*.
**Plan:** `docs/UX-PLAN-2026-10-21.md` → **P1** (modül tabanlı, katlanır,
sürüklenebilir split, özelleştirilebilir).
> **22.10.2026 F1:** katlanır + modül kabuğu uygulandı (UX-045); modül seçimi ve
> sürüklenebilir split (F3) hâlâ planlı.

### UX-032 · Genel Bakış · Kart "sonuç" idi, "konu" eksikti — `düzeltildi`
**Belirti:** "Disk değişti" bir **sonuç**tur; neyin sonucu olduğu belirsizdi.
Kullanıcı: *"aslında bir sonuç. Neyin sonucu 'Önceki Tarama'nın sonucu…
Başlık 'Önceki Tarama' olmalı, sonra alt başlık sonucu üretmeli."*

**Çözüm (motor):** `DashboardCardView` artık **konu + sonuç** taşır:
- `titleId: DashboardCardTitleId` → `Önceki Tarama` · `Ortam yolları` ·
  `Ortam değişkenleri` · `Komut yolu` · `Araç kurulumları` · `Bağımlılıklar` ·
  `Yarım kalan işlemler` · `Kasa ögeleri` · `Zamanlanmış işler`
- `stateId: DashboardCardId` → mevcut sonuç etiketleri
  (`Disk değişti` · `Yol sorunu` · `Gölgede kalan komut` …)

Kart görünümü: satır 1 = konu + sayı, satır 2 = sonuç + hedef ekran.

### UX-033 · Genel Bakış · Üstteki rozet gereksiz tıklanabilirdi — `düzeltildi`
**Belirti:** Sayfa başındaki "Disk değişti" rozeti tıklanabilirdi, ama aynı
veri alttaki kartta da vardı. Kullanıcı: *"üstteki disk değişti kartının
tıklanabilirliğini kaldır. çünkü aynı veri alt kartta da gösteriliyor."*

**Çözüm:** Sayfa başındaki rozet artık `<span>` (`cursor: default`, rol yok) —
**tıklanamaz**. Üst çubuktaki global rozet tıklanabilir kalır (oradan ayrıntı
raporu açılır).

### UX-034 · Genel Bakış · Kartlar indeksti, detay yoktu — `düzeltildi`
**Belirti:** Kartlar bilgi taşıyordu ama hiçbir eylem yoktu (UX-006/007).
Kullanıcı: *"her kart tıklanabilir olmalı… ve her kartın detayı altındaki
listede gösterilmeli."*

> **22.10.2026 düzeltmesi:** Tıklanabilirlik yanlış kümeye (risk kartlarına)
> verilmişti; doğrusu **defter kartları**ydı. Ayrıntı: **UX-044**.

**Çözüm (motor):** Yeni `src/core/dashboard-details.ts` → `DashboardDetails`
saf sınıfı. Her kart için **detay satırları** üretir (yol, komut, araç, kenar,
işlem, kasa öğesi, plan). `DashboardResponse.details` ile API'den gelir.
Arayüz yalnızca basar; hangi kartın seçildiğini bilir, satırları hesaplamaz.

- **Defter kartları** `<button>` (`aria-pressed`); tıklanınca **alt liste** o
  defterin detayına dönüşür; "Panele dön" ile geri alınır.
- **Risk kartları** statik `<article>`: Önceki Tarama, Ortam yolları, Komut yolu.
- Satır etiketleri **doğru alandan** gelir: yol bulgularında sol = yol, sağ =
  gerekçe (`variable` alanı her zaman "Path" olduğu için kullanılamaz);
  gölgede komutta sol = komut adı (`klist`, `notepad`, `wsl`).

### UX-035 · Tüm listeler · "Hangi taramadan?" belirtilmiyordu — `düzeltildi`
**Belirti:** Kullanıcı: *"listenen içeriklerin de önceki taramadan elde edilen
verilerin listesi olduğu söylenmeli… her tarama tarih ile damgalanmalı."*

**Kanıt:** `DashboardScanView.at` **zaten** taşıyordu ama arayüzde **mutlak
tarih hiç gösterilmiyordu** — üst çubukta sadece göreli "9 saat önce".

**Çözüm:** `web/src/components/ScanStamp.tsx` → damga satırı:
`Önceki taramadan · 21 Eki 2026 14:54 · 9 saat önce`. Genel Bakış başlığında ve
"Güvenli Kazanımlar" panelinde kullanılır. Tarih **motordan** gelir
(`scan.at`), arayüz yalnızca biçimlendirir.

### UX-036 · Motor · Tarama damgası iki yerden farklı geliyordu — `düzeltildi`
**Belirti:** `scan-service.ts:379` → `at: Date.now()` (kayıt anı) ile
`scan-cache.ts:83` → `at = scan.finishedAt` (bitiş anı) **çelişiyordu**.
`dirty` kararı `dirtyAt > at` ile verildiği için **sunucu yeniden başlayınca
"Disk değişti" rozeti kendiliğinden değişebiliyordu.**

**Çözüm:** Bellekte de `at = result.finishedAt`. Aynı veriden aynı damga.

### UX-037 · Motor · Her tarama için kayıt tutulmuyor — `planlandi`
**Belirti:** Kullanıcı: *"her tarama tarih ile damgalanmalı."*
**Kanıt:** `store/scan-cache.ts:18` → `last-scan.json` — **tek dosya**;
`scan-service.ts:382` her yeni taramada **üzerine yazıyor**. Yani tarih
damgalı tek kayıt **sonuncusudur**; tarama geçmişi yok.
**Plan:** `docs/UX-PLAN-2026-10-21.md` → **P9** (`scans/index.json`).

---

## Özet (durum)

| Durum | Adet |
|---|---|
| `düzeltildi` | 18 (UX-001, UX-009, UX-013, UX-027, UX-028, UX-032..036, UX-038..045) |
| `planlandi` | 4 (UX-029, UX-030, UX-031, UX-037) |
| `acik` | 22 (kalanlar) |
| `reddedildi` | 0 |

**Denetimde sınanan ama sorun OLMAYANLAR (kayıt için):**
- **Sanal liste ölçüm hatası yok.** `estimateSize: () => 46` ile gerçek satır
  yüksekliği birebir uyuşuyor (`h: 46`, `contentH: 45`, `transform` 46 px adım).
  Satır kayması/örtüşme yok.
- Kontrast: `--dim #8b9bb0` / `--bg #0b0f14` ≈ **6.8:1** (AA geçer),
  `--faint #74839a` ≈ **5.0:1** (AA geçer).

---

## Çalışma düzeni (denetim nasıl yürütülür)

1. **Önce ölç.** Her madde bir gözlemle değil, bir ölçümle yazılır
   (`getBoundingClientRect`, `getComputedStyle`, API yanıtı).
2. **Sunucuyu doğrula.** "Arayüz değişmedi" görüntüsü **önce sürüm kontrolü**
   ister: statik kabuk her istekte diskten okunur, API kodu süreç başında
   yüklenir. **Eski sunucu süreci + yeni derleme = bozuk sayfa.**
   Kontrol: `bundle` adı eskiyse derleme yapılmamış; `bundle` yeni ama API
   eski şekildeyse süreç yeniden başlatılmamış. (Ayrıntı: `AGENTS.md` §3 K15.)
3. **Motorda karar.** Düzeltme `src/core/*` içinde yapılır; web yalnızca
   kimliği metne çevirip basar. "Hesap web'de" olan bir düzeltme reddedilir.
4. **Gerçek tarayıcıda doğrula.** `ego-browser` ile: ekran görüntüsü + DOM
   ölçümü + klavye akışı (Esc, odak tuzağı, odak dönüşü) + TR/EN.
5. **Logu güncelle.** Madde `düzeltildi` olur; kanıt ve doğrulama kaydı yazılır.

**Yarım kalan denetim:** Disk ekranı ölçüldü (UX-017..UX-025), ancak
Plan → Projeler → Araçlar → PATH & Ortam → Graf → Planlar → Kasa → Ayarlar
ekranları henüz **ilk kullanıcı gözüyle** denetlenmedi. Bu log o ekranlar
için henüz tamamlanmamıştır.
