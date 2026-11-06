# Değişiklik Günlüğü

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.
Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.1/) temellidir.

## [0.3.0-alpha.0] - 2026-10-22

### Düzeltildi

- Tarama durumu artık tek kaynaktan geliyor; üst çubuk ile Genel Bakış
  kartı aynı bilgiyi gösteriyor.
- "Yeniden tara" düğmesi taramayı gerçekten başlatıyor.
- Genel Bakış detay listeleri ve PATH gerekçeleri TR/EN olarak gösteriliyor.
- Aynı detayı paylaşan plan kartlarının seçimi düzeltildi.
- "Disk değişti" durumu tüm yüzeylerde aynı önem tonunu kullanıyor.

### Eklendi

- **Sağ panel ekranlardan bağımsız modül yüzeyine dönüştü.** Kanıtlar, İşlem,
  Planlananlar ve Bağlam sekmeleri; Disk, Araçlar, PATH & Ortam, Projeler ve
  Graf detayları aynı panelde; planı görüntüleme ve plandan çıkarma.
- Sağ panel varsayılan açık, katlanabilir; dar ekranda gizlenir.

### Değişti

- Proje **beta öncesi (alpha)** olarak işaretlendi; sürüm `0.3.0-alpha.0`.

## [Unreleased]

### Eklendi

- **Graf: özet kartları + sekmeli çalışma alanı.** Altı özet kartı
  (düğümler, kenarlar, kopuk, gölgede, döngü, kritik) renk kodlu ve
  tıklanınca ayrıntı açıyor: tür/sayım listeleri, kopuk ve gölgeli kenarlar,
  kritik düğümler. Düğümler ve kenarlar tek panelde **sekmeli**; liste sabit
  yükseklikte kaydırılıyor, sayfa aşağı uzamıyor.
- **Graf: düğümler ağaç görünümünde.** Düğümler türe göre gruplu (araçlar,
  paketler, shimler, PATH, ayarlar…); **Genişlet / Daralt** ve satır aç/kapa;
  bir satır açılınca **ilişkiler + etki analizi** satırın altında birlikte
  görünüyor. Etki durumu **Kaldırılabilir / Kısmi etki / Engelli** olarak
  ayrılıyor. Bakış profili (Koruyan/Deneyen) yalnız sıralamayı değiştirir;
  etki analizi her iki profilde de var.
- **Graf: “Düğüm testi” sonuçları.** Serbest arama sonucunda yalnız sayı
  değil, **kaldırılabilir düğümlerin ağaç listesi** de gösteriliyor; her
  satırda tür/seviye ve “İncele” ile ilgili ağaç satırına gitme var.
  Başlık “What-if” yerine **Düğüm testi**.
- **Graf: açıklamalı kök nedenler.** “Kök neden yok” artık ne arandığını ve
  bunun sağlıklı bir sonuç olduğunu açıklıyor. Özet açıklaması kopuk/gölgede/
  döngü kavramlarını tanımlıyor.
- **Graf hazırlığında ilerleme.** İlk envanter taraması canlı araç sayısı ve
  adım göstergesiyle (1/2 → 2/2) ilerliyor; düz metin yerine ilerleme
  çubuğu gösteriliyor.

### Kaldırıldı

- **Doğrudan yol kalıcı silme.** `clean --purge` ve
  `POST /api/plan {mode:'purge'}` artık reddedilir; kalıcı silme yalnız kasa
  öğelerinde (`residue vault purge --id <kasa-id>`) ve `BOŞALT` onayıyla
  yapılır.

### Düzeltildi

- **Türkçe büyük harf.** Başlık ve etiketler artık dile göre büyütülüyor:
  Türkçe seçiliyken `disk` → **DİSK**, `Düğüm testi` → **DÜĞÜM TESTİ**.
  Önceki CSS büyütmesi Türkçe i kuralını uygulamıyordu; tüm ekranlardaki
  başlık, tablo başlığı ve kart etiketleri kapsandı.
- **Graf metinleri.** “Hiçbir şey silinmez” gibi ifadeler kaldırıldı; ekran
  yalnızca ilişki ve etki analizi gösterdiğini söylüyor. Bu, seçim/silme
  olmayan bir ekranda gereksiz korku yaratıyordu.
- **Kasa geri yükleme çakışması.** “Klasör dolu” yerine hedefin durumu
  açıklanıyor: sonradan oluşmuş/güncellenmiş içerik, daha eski içerik, boş
  klasör veya bilinmiyor. Kopya çakışmada ayrı adla geri yüklenir.
- **Kasa boşaltma bildirimi.** Orijinal konumda daha yeni içerik varsa eski
  kopyanın geri yüklenmediği ve kasadaki kopyanın kalıcı silindiği açıkça
  söyleniyor. Payload'u zaten kaybolmuş kayıtlarda yalnız kayıt temizlenir;
  orijinal içeriğin korunduğu bildirilir.
- **Klavye odağı.** İlk açılış diyaloğu ve komut paleti artık odağı içeride
  tutuyor; kapandığında odak açan öğeye dönüyor. `Esc` sonrası odak `body`'ye
  düşmüyor. Bu, klavye ve ekran okuyucu kullanımında gezinmeyi güvenilir kılar.

## [2.2.0] - 2026-10-21

### Eklendi

- **Arayüz temeli (T44 / M0):** `web/` (React 19 + Vite + TypeScript),
  `residue ui --web`, `dist/web` pakete girer. Arayüz yalnızca istek
  gönderir; kararlar motordan gelir. Token, `HttpOnly + SameSite=Strict`
  çerezle taşınır (URL'de token yok). TR/EN, 3 sütunlu koyu tema.
- **Başlangıç özeti motoru** (`core/dashboard-summary.ts`) ve
  `GET /api/dashboard`: korunan/geri kazanılabilir defterleri, risk
  kartları, güvenli kazanımlar ve karar sayıları. Ağır tarama tetiklemez.
- **Proje keşfi motoru** (`core/project-discovery.ts`) ve
  `GET /api/projects/discover`: `.git`/manifest/artifact kanıtıyla repo
  listesi; salt okunur, silme hedefi üretmez.
- **Projeler ekranı (T44 / M2, salt okunur):** kök düzenleyici, motor
  özeti, sekmeler (tümü / bağımlılıklı / Git / ajan alanı), arama ve
  sıralama; proje raporunda bağımlılık klasörleri, boyutlar, lockfile
  hash'i, kurulum/doğrulama tarifi, riskler ve plan engelleri. Filtre,
  sıralama, sayım ve toplamlar `core/project-view.ts` motorundan gelir.
  Proje kaynağı hiçbir koşulda hedef değildir; arayüzde silme, plan
  yürütme veya tarif çalıştırma yoktur. Keşif 60 sn önbelleklidir. Onay
  kurallarına `projectRestore` (`KUR`) eklendi.
- **Araçlar + PATH/Env + Graf (T44 / M3):** kanal bazlı araç envanteri
  (SSE, durum/kanal filtreleri, arama, sıralama, kanıt paneli, `SIL`
  kaldırma planı ve bağımlılık engeli); PATH/ortam analizi, plan
  öncesi/sonrası değişiklikler, yedek bilgisi ve yazılı `TEMIZLE` onayı;
  bağımlılık grafiği, kök nedenler ve gerekçeli what-if engeli. Filtre,
  sıralama ve sayımlar `core/cli-view.ts` motorundan gelir. Onay
  kurallarına `envClean` (`TEMIZLE`) eklendi.
- **Planlar + Ayarlar + Güncelleme (T44 / M4):** zamanlanmış kural
  oluşturma yazılı **`PLANLA`** onayı ister; kural seçici saklar ve
  yalnız kasaya taşır. Planlar ekranında önizleme, iki adımlı çalıştırma
  ve silme, kaçırılan çalışma önerileri ve geçmiş; Ayarlar ekranında
  tarama önbelleği, kasa saklama, güncelleme modu ve isteğe bağlı sürüm
  kontrolü. Güncelleme kontrolü kapalıyken ağ isteği yapılmaz.
- **Disk görünümü motoru** (`core/disk-view.ts`) ve `GET /api/disk` /
  `GET /api/cluster`: filtre, sıralama, kategori sayımı ve seçim özeti
  motorda; arayüz yalnız gösterir. Plan ve kasa onay ifadeleri
  `ApprovalRules`'tan gelir: kasaya taşıma **`TASI`**, kalıcı silme `SIL`,
  kasa boşaltma `BOŞALT`. Arayüz düğmesi bu kurala göre pasif kalır;
  gerçek doğrulama sunucudadır.
- **Arayüz M1:** Disk (sanal liste, canlı SSE tarama, filtreler, kanıt
  paneli), Plan/Onay (yazılı `TASI`; kalıcı silmede `SIL`, yüksek risk
  işaretleme, canlı yürütme) ve Kasa (geri yükleme, seçili öğeleri kalıcı
  silme). Arayüz yalnız istek gönderir; onay ifadeleri sunucudan gelir.
  Doğrudan yol silme (`purge` yol modu) arayüzde yoktur; kalıcı silme
  yalnız kasa öğesi kimliğiyle ve `BOŞALT` onayıyla yapılır.
- **Kabuk sınırı testi:** `web/src` Node builtin'i, servis/aksiyon katmanını
  veya çekirdek karar sınıflarını import edemez; yalnız sözleşme tipleri ve
  saf `ApprovalRules` paylaşılır.
- **Klavye ve erişilebilirlik (T44 / M5):** "İçeriğe geç" ve "Listeye geç"
  bağlantıları; bölümler arasında ok tuşlarıyla gezinme; `/` ile aramaya
  odaklanma; `?` ile klavye kısayolları penceresi (odak tuzağı, `Esc` ile
  kapanma ve odağı geri verme). Satır eylemleri artık gerçek düğme; seçim
  sayısı ekran okuyucuya canlı bildirilir. Odak halkaları, `prefers-reduced-motion`
  desteği ve metin kontrastı iyileştirildi.
- **Duman testleri:** `npm run smoke` (çerez token, token'sız 401, yabancı
  Host 403, tüm okuma uçları, yazılı onay kapıları) ve
  `npm run smoke:package` (`npm pack` → boş klasöre kur → arayüzü aç).
- Test: `npm test` 92 test; `npm run smoke` temiz.

### Düzeltildi

- Kasaya taşıma onayı artık **`TASI`** ister; `SIL` yalnız kalıcı silmede
  kullanılır. Yazılı onay düğmesi, ifade motorun `ApprovalRules` kuralına
  uymadan ve yüksek risk işaretlenmeden pasif kalır; sunucu doğrulaması
  son savunma hattı olarak korunur.

## [2.1.0] - 2026-10-21

Motor genişlemesi: kanıt ağacı, bağımlılık grafı, ortam değişkeni, proje
bağımlılık ve plan/zamanlama motorları eklendi. Arayüz değişmedi; yeni
yetenekler CLI ve yerel API üzerinden kullanılır.

### Eklendi

- **Kanıt ağacı** (`core/evidence-tree.ts`): gözlem → kanıt → iddia →
  aday → araç; `supports/protects/unknown` duruşları ve tekilleştirilmiş
  `obsId` referansları. `Cluster.evidenceTree` alanına bağlandı.
- **Bağımlılık grafı** (`core/dependency-graph.ts`): düğüm/kenar türleri,
  roller, seviyeler, Tarjan döngü tespiti, kök neden gruplaması ve
  `whatIf()` simülasyonu. CLI kaldırma planı artık sert/aktif bağımlılık
  varsa aracı engelliyor (`blocked` alanı).
- **Ortam değişkeni motoru** (`core/env-engine.ts`): HKCU/HKLM PATH
  analizi, eksik/tekrar/gölgelenen girdiler, yetim `*_HOME`/`*_PATH`,
  hassas değer maskeleme, plan → yedek → kayıt defteri → WM_SETTINGCHANGE.
  `residue env` komutu ve `/api/env*` uçları.
- **Proje bağımlılık motoru** (`core/project-deps.ts`): npm/pnpm/yarn/bun,
  Python, .NET, Rust; lockfile hash'li tarif, yeniden üretilebilirlik
  kontrolleri, `npm ci`/`--frozen-lockfile` komutları, toplu geri kurulum.
  `residue project` komutu ve `/api/projects*` uçları.
- **Plan/zamanlama motoru** (`core/plan-engine.ts`, `services/schedule-service.ts`):
  seçici tabanlı günlük/haftalık planlar, kaçırılan çalışma telafisi,
  kilit ve çalışma geçmişi. Planlı işlem yalnız kasaya taşır.
  `residue schedule` komutu ve `/api/schedules*` uçları.
- **Vault iyileştirmeleri:** kararlı öğe kimliği, `meta.json`, atomik
  manifest, `index.json` yeniden oluşturma, seçili öğe boşaltma
  (`purgeVaultItems`), çakışma politikası (`rename/overwrite/cancel`) ve
  geri yükleme doğrulaması. `residue vault` komutu.
- **Operation journal** (`core/operation-journal.ts`): `pending →
  in-progress → done/failed/skipped`; `residue recover` ve `/api/recover`.
- **AppError modeli** (`core/app-error.ts`): normalize edilmiş hata türleri,
  `retryable`, `dataSafe`, `operationId/itemId`; API hata gövdesi.
- **Tarama:** erişilemeyen yollar `skipped` olayına akıyor, hedef içi canlı
  ilerleme, duraklat/devam uçları, `--root` dışlamaları, atomik/sürümlü
  tarama önbelleği.
- **Kategoriler:** protected / duplicate / old-version / orphan / unused /
  ai-debris / ghost-envs / unknown ve sahip durumu (active/orphaned/shared/unknown).
- `npm test` (node:test) ve 56 test.

### Düzeltildi

- Sürücü kökü koruması: `D:\` artık reddediliyor (önceki regex yalnız `d:` yakalıyordu).
- Kasa geri yüklemede çakışma hatası orijinal yola düşmüyor; `cancel`
  seçeneği veri kaybı olmadan duruyor.
- Başarısız kalıcı silme artık "yer kazanıldı" sayılmıyor.
- `purgeVault` CLI yedek/karantina klasörlerini silmiyor.
- SSE yeniden bağlanmada çalışan tarama aboneliği kopmuyor.
- Ayarlarda `vaultRetentionDays` ve `updateCheck` sessizce yok sayılmıyor.
- Onay sorusunda `h` artık "evet" sayılmıyor (Türkçe "hayır").
- Varsayılan seçim yalnızca `risk=safe` öğeleri kapsıyor.

## [2.0.1] - 2026-10-21

### Düzeltildi

- `npx residue-cleaner` artık çalışıyor: paket adıyla eşleşen bir komut
  takma adı eklendi. Ana komut yine `residue`.

## [2.0.0] - 2026-10-21

Tarayıcı arayüzü kaldırıldı ve proje yeniden adlandırıldı: **Residue**
(npm paketi `residue-cleaner`, komut `residue`). Araç artık **yalnızca
terminalden** çalışır.

### Değiştirildi

- **Proje adı:** `CLICleaner` → **Residue**. npm paketi `residue-cleaner`,
  komut `residue`.
- **Veri dizini:** `%LOCALAPPDATA%\clicleaner` → `%LOCALAPPDATA%\residue`
  (kasa, günlük ve tarama önbelleği taşındı; eski dizin silinmez).
- `clicleaner` (komutsuz) artık tarayıcıyı açmaz; **yardım metnini** gösterir.
- `residue ui` artık **terminal arayüzünü** açar.
- `residue api` eklendi: arayüzü olmayan, yalnız bu bilgisayarda çalışan
  HTTP/SSE servis arayüzü.

### Kaldırıldı

- **Tarayıcı arayüzü** ve beraberindeki derleme/veri bağımlılıkları.
- **Masaüstü kısayolu** oluşturma/kaldırma özelliği (yalnız arayüzü açıyordu).
- Tarayıcı açma seçenekleri ve tarayıcıya özel ayarlar.

### Eklendi

- Arayüzün yeniden yapımı için plan belgesi (`docs/WEB-REBUILD-PLAN.md`).

> Not: Bu sürümden önce yayınlanan npm paketi `clicleaner`'dır ve
> kullanımdan kaldırılmıştır. Yeni paket: `residue-cleaner`.

## [1.0.0] - 2026-10-21

İlk genel kullanım sürümü. Web arayüzü bu sürümden itibaren baştan
tasarlanacaktır; 1.x çizgisi arayüz çalışması için ayrılmıştır.

### Eklendi

- **Kendi kasa:** silinen öğeler artık Windows Geri Dönüşüm Kutusu'na
  değil, aracın kendi kasasına taşınır. Kasadan tek tıkla geri yüklenir,
  toplu geri alınabilir ve kullanıcı yazılı onayıyla boşaltılabilir.
- **Tarama durumu:** son taramanın zamanı, güncelliği ve önbellek süresi
  arayüzde görünür; süresi dolmuş sonuçlar da yüklenebilir, tarama hiçbir
  zaman engellenmez.
- **Canlı tarama akışı:** bulunanlar anında listeye düşer, uzun listeler
  akıcı kaydırılır, canlı tarama sırasında konum korunur.
- **Kanıt tabanlı sınıflandırma genişletildi:** model depoları, vektör
  indeksleri, ajan çalışma alanları, proje bağımlılıkları, pnpm/yarn/bun
  depoları, NuGet deposu ve güncelleyici artıkları yapılarına göre tanınır.
- **CLI envanteri genişletildi:** kurulu araçların atıl olup olmadığı,
  PATH kaynakları, Node sürüm yöneticisi kopyaları ve kaldırma öncesi
  referans kontrolü raporlanır; atıl araçlar güven düzeyiyle listelenir.
- **Hassas temizlik seçenekleri:** sohbet geçmişi, model depoları ve kural
  dosyaları varsayılan olarak plana girmez; yalnızca açık seçenekle ve
  yazılı onayla temizlenir.
- **Paylaşılabilir inceleme raporu:** envanter, kanıtları ve önerilen
  komutlarla birlikte Markdown olarak dışa aktarılır.
- **Güncelleme politikası ekranı:** aracın ne gönderdiğini, neden göndermediğini
  ve manuel güncelleme adımlarını gösterir; ağ isteği yapmaz.
- **Geliştirici arayüzü için canlı geliştirme modu:** arayüz değişiklikleri
  tarayıcıda anında görülür.

### İyileştirildi

- **Güvenlik:** iki aşamalı onay korunur, aracın kendi verisi hiçbir taramada
  aday gösterilmez, sürüm kontrolü altındaki dosyalar silinmez.
- Silme güvenliği artırıldı: sembolik bağ ve junction'lar atlanır, korumalı
  yolların üstü asla hedeflenmez.
- Sürüm ve bozuk kurulum kontrolü, bilinmeyen programları çalıştırmadan yapılır.
- Uzun listelerde kaydırma, sıralama ve canlı tarama akışı iyileştirildi.
- Web arayüzü artık sistem varsayılan tarayıcısında açılır.

### Değişiklikler

- Varsayılan seçim, yeniden üretilebilirliği kanıtlanmış ve güven düzeyi
  düşük olmayan öğelerle sınırlıdır.
- Web arayüzü yerel bilgisayarda çalışır; her açılışta yeni bir güvenlik
  jetonu üretilir.

## [0.7.0] - 2026-10-20

### Eklendi

- **Proje bağımlılıkları:** proje taramasında `node_modules` / `.venv`
  klasörleri, üst dizindeki proje dosyalarıyla birlikte değerlendirilir;
  yeniden kurulabilirlik ve güven düzeyi gösterilir. Bu klasörler yalnızca
  raporlanır, silme hedefi olmaz.
- **Paket depoları:** pnpm, yarn ve bun depoları ada değil yapıya göre
  tanınır. pnpm/bun ana klasörleri uygulama da içerdiği için yalnızca depo
  alt klasörü hedeflenir; uygulama klasörü korunur.
- **PATH kaynakları:** CLI envanteri, kullanıcı ve makine PATH'ini
  karşılaştırır; yinelenen ve artık var olmayan dizinleri listeler.
- **Kaldırma öncesi referans kontrolü:** CLI envanteri, aracı kullanan
  çalışan süreçleri, yapılandırma dosyalarını, kısayolları ve zamanlanmış
  görevleri salt okunur tarar. Referans varsa kaldırma güveni düşer ve
  plan ekranında "önce kapat/kaldır" notu gösterilir.
- **Node sürüm kopyaları:** CLI envanteri, Node sürüm yöneticilerinin
  (nvm / fnm / volta) barındırdığı sürümleri yapıdan tanır; hangi sürümün
  aktif olduğunu gösterir ve eski sürümlerin global paketlerini inceleme
  notuyla listeler. Otomatik seçim veya silme yoktur.
- **Hassas temizlik bayrakları:** sohbet geçmişi (`--clear-history`),
  tüm model depoları (`--nuke-models`) ve kural dosyaları (`--reset-rules`)
  varsayılan olarak plana girmez. Yalnızca açık bayrakla ve iki aşamalı
  onayla temizlenir.
- **Daha güvenli inceleme:** sürüm bilgisi ve bozuk kurulum kontrolü,
  bilinmeyen programlar çalıştırılmadan yapılır.

### İyileştirildi

- **Tarama durumu:** son tarama zamanı, güncel/eski durumu ve yeniden tarama
  önerisi arayüzde görünür. Tarama hiçbir zaman engellenmez; "önceki sonuçları
  göster" ve "yine de yeniden tara" seçenekleri sunulur. Önbellek süresi
  ayarlardan değiştirilebilir; silme sonrası sonuç "eski" işaretlenir.
- **Plan görünümü:** silme planı risk gruplarına ayrıldı; özet üstte sabit,
  hedef yolları isteğe bağlı açılıyor.
- **Kendi kasa:** Windows Geri Dönüşüm Kutusu yerine silinen öğeler aracın
  kasasına taşınır. Manifest, atomik taşıma ve çakışmada `.restored-*`
  olarak geri yükleme vardır (`clicleaner undo --restore`).
- **Kasa ekranı:** silinen öğeler listelenir; tek tıkla geri yüklenir,
  çakışma ve kalan gün gösterilir. Saklama süresi ayarlardan değiştirilebilir
  (bilgi amaçlı; otomatik silme yok).
- Varsayılan seçim yalnızca yeniden oluşturulabilirliği kanıtlanmış ve
  güven düzeyi düşük olmayan klasörleri işaretler.
- Ajan çalışma alanları ayrı bir sınıf olarak tanınır: beceri ve plan
  dosyaları korunur, eklenti bağımlılıkları yalnızca raporlanır.
- Ayarlar'a **Güncelleme Politikası** bilgi ekranı eklendi; manuel güncelleme
  komutları ve adresleri gösterilir, ağ isteği yapılmaz.
- Kasa erişimi düzeltildi: silme sonrası **Kasayı aç** artık uygulamanın Kasa
  sekmesini açar. Kasa ekranına **Kasadakileri geri al** ve yazılı onaylı
  **Kasayı boşalt** eklendi.
- Silinebilir özetine tek tıkla **Seç** düğmesi eklendi.
- Web arayüzü artık sistem varsayılan tarayıcısında açılır; istenirse Edge
  zorlanabilir.
- Uzun listelerde kaydırma ve canlı tarama akışı iyileştirildi.
- Son tarama zamanı ve durumu düzeltildi.
- Tarama ve listeleme işlemi düzeltildi ve iyileştirildi.

## [0.6.0] - 2026-10-19

### Eklendi

- **Proje taraması:** web arayüzünde **Projeyi Tara** ile klasör seçip tara;
  terminalde `clicleaner scan --root <dizin>`. Sonuçlar salt rapordur ve
  yalnızca seçilen klasörün alt klasörleri incelenir.
- **Git farkındalığı:** sürüm kontrolü altındaki (tracked) dosyalar hiçbir
  modda silinmez; yalnızca untracked veya `.gitignore` içindeki yollar
  değerlendirilir. Web listesinde `Git` sekmesi ve `git` etiketi bulunur.
- Silme güvenliği iyileştirildi: sembolik bağ ve junction'lar hedefiyle
  birlikte değil, atlanarak işlenir; aracın kendi veri dizini hiçbir taramada
  aday gösterilmez.

### İyileştirildi

- Tarama ve listeleme işlemi düzeltildi ve iyileştirildi; proje taraması
  sisteminizin son tarama sonucunu etkilemez.
- Klasör seçici ve kart görünümü iyileştirildi.

## [0.5.0] - 2026-10-18

### Eklendi

- **Web arayüzünde karantina:** paket yöneticisi olmayan bağımsız araçlar için
  "Karantinaya al" düğmesi ve `KARANTINA` yazılı onaylı plan ekranı. Shim kasaya
  taşınır (komut PATH'ten düşer), durum klasörleri kopyalanır, veriler yerinde
  kalır; geri dönüş adımları `RESTORE.md`'ye yazılır.

## [0.4.0] - 2026-10-18

### İyileştirildi

- Tarama işlemi düzeltildi ve iyileştirildi; altyapı düzenlemeleri yapıldı.

### Eklendi

- **Ajan kurulum izi (T17):** npm `_logs` günlüklerinden `install -g` satırı,
  kurulum saati ve çalışma dizini (cwd) okunur. cwd içinde `skills/`,
  `sessions/`, `SKILL.md`, `.skill-lock.json` gibi **yapısal** izler varsa
  "ajan izi" kanıtı yazılır; uygulama adı aranmaz.
- **Öksüz / eksik shim taraması:** shim var ama hedefi yok; paket kurulu ama
  shim yok; boş `@scope` klasörü. Hepsi yalnızca **raporlanır**, silinmez.
- **PATH gölgeleme:** aynı komut PATH'te birden fazla kez bulunuyorsa ilki
  çalışır, kalanlar gölgede listelenir; yinelenen PATH dizinleri tekilleştirilir.
- **Karantina modu (T19):** paket yöneticisi olmayan bağımsız araçlar silinmek
  yerine kasaya taşınır. Shim PATH'ten düşer, durum klasörleri kopyalanır,
  `manifest.json` + `RESTORE.md` geri dönüş adımlarını verir.
  `clicleaner quarantine <ad> [--dry-run]`; yazılı `KARANTINA` onayı zorunlu.

## [0.3.0] - 2026-10-18

### Eklendi

- **Komut çakışması:** aynı komutu sağlayan birden fazla kurulum (ör. yeni CLI +
  eski CLI) birlikte listelenir; shim'in gösterdiği aktif kurulum korunur,
  gölgede kalan eski paket için kaldırma planı üretilir.
- **Bozuk / yarım kurulum tespiti:** stub bin + kurulum betiği + çalıştırma
  hatası kanıtıyla tespit; npm, uv, dotnet, pip ve standalone kapsanır.
- **Onarım planı:** paket yöneticisinin kendi `install` komutu (`--allow-scripts`
  / `--force`); web'de `ONAR` yazılı onayı, terminalde `clicleaner repair`
  komutu ve **canlı çıktı akışı**.
- Kaldırma sonrası **shim onarımı**: gölgede kalan paket silinince komutun
  kaybolmaması için aktif paket yeniden bağlanır.
- **Markdown raporu:** `clicleaner inventory --report <dosya.md>` — özet,
  atıl araçlar ve kanıtları, çoklu kurulum analizi ve önerilen
  kaldırma/onarım komutlarıyla paylaşılabilir rapor.

## [0.2.1] - 2026-10-18

### Belgelendirme

- README: AI araçlarında yeni olanlar için sade anlatım — "AI kod araçları
  kullanıyorsan", ne bulur / neye dokunmaz, güvenlik, SSS ve basit sözlük.
- GitHub deposuna açıklama, web sitesi ve 20 **topic** eklendi; npm anahtar
  kelimeleri genişletildi (AI, disk-space, conda, cuda, devtools…).

## [0.2.0] - 2026-10-18

### Değişti

- **Varsayılan giriş artık web arayüzü.** `clicleaner` tarayıcıyı açar; terminal
  TUI yalnızca `clicleaner ui --tui` ile isteğe bağlıdır. `clicleaner ui` ve
  eski `ui --web` de web arayüzünü açar.
- Başlangıç çıktısı sadeleştirildi: kısa açıklama + `http://localhost:<port>`.
  Güvenlik token'ı yalnızca `--no-open` modunda yazdırılır.
- Yardım metni **Başlamak için / Gelişmiş** olarak gruplandı.

### Düzeltildi

- Arayüzde "kök" yerine "dizin" terminolojisi (TUI ve terminal çıktısı).

## [0.1.0] - 2026-10-18

İlk kamuya açık sürüm (anasürüm).

### Eklendi

- **Kanıta dayalı sınıflandırma:** `CACHEDIR.TAG`, `.nupkg/.nuspec`, ONNX model
  dosyaları, CUDA/ORT DLL'leri, `pyvenv.cfg`/`conda-meta`, `.vhd/.vhdx`,
  güncelleyici artıkları, ajan beceri depoları, editör uzantı depoları ve
  `app-<sürüm>` kurulumları. Kaynak kodda uygulama adı geçmez.
- **Hedefli silme:** klasörün tamamı yerine yalnız güvenli kısım (ör. `Temp`'te
  3 günden eski dosyalar, Electron'da yalnız `Cache`/`GPUCache`).
- **İki aşamalı onay:** plan → yazılı `SIL`; orta/yüksek riskte `--yes` bypass
  edemez. Varsayılan mod geri dönüşüm kutusudur.
- **`guard.ts` güvenlik kapısı:** korunan yolların atası hedef olamaz.
- **Paralel dosya yürüyücüsü:** `\\?\` uzun yol desteği ve junction döngü koruması.
- **Terminal TUI (Ink) ve yerel web arayüzü:** yalnız `127.0.0.1`, her başlatmada
  rastgele token, Host/Origin doğrulaması, 10 dakikalık plan TTL'si.
- **Canlı tarama (SSE):** disk taramasında taranan dizinler ve bulunan kümeler
  anlık akar; CLI envanterinde araçlar bulundukça listelenir; iptal sunucudaki
  işi gerçekten durdurur.
- **Kullanılmayan CLI envanteri:** npm/uv/dotnet/pip/standalone kaynakları,
  atıllık kanıtı (shim erişimi, durum klasörü, kabuk geçmişi) ve güven düzeyi.
- **Kaldırma planı + yedek kasası:** durum klasörleri kasaya kopyalanır,
  kaldırma paket yöneticisinin kendi komutuyla planlanır.
- **24 saatlik tarama önbelleği**, günlük (`journal`), `undo`, `log --summary`,
  `doctor`, `explain`, `rules`, `status` komutları.
- **Arayüz:** TR/EN, disk listesinde kategori sekmeleri, risk/boyut/tarih/ad
  sıralaması, kademeli listeleme; tarama sonunda `Tamam` diyalogu.
- **Belgelendirme:** iki dilli README — Türkçe (varsayılan) `README.md` ve
  İngilizce `README.en.md`; kurulum, ilk çalıştırma, kaldırma ve sorun giderme.

### Bilinen sınırlar

- Yalnızca Windows (geri dönüşüm kutusu ve `%LOCALAPPDATA%` varsayımları).
- Gerçek uninstall yolu plan düzeyinde test edildi; ilk gerçek kaldırma testi
  henüz yapılmadı.
- `atime` kanıtı antivirüs/indexer tarafından etkilenebilir; güven düzeyi
  arayüzde açıkça gösterilir.
