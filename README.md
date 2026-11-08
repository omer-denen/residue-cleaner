# Residue

![platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Lisans](https://img.shields.io/github/license/omer-denen/residue-cleaner)
![Sürüm](https://img.shields.io/github/v/tag/omer-denen/residue-cleaner?label=s%C3%BCr%C3%BCm)

**Türkçe (varsayılan)** · [English](README.en.md)

**CLI temizleyici ve kanıt denetleyicisi.** AI kod araçları ve geliştirici
araçları arkalarında CLI önbellekleri, model depoları, sanal ortamlar, oturumlar
ve güncelleyici artıkları bırakır; bunlar Windows "Program ekle/kaldır"
listesinde **görünmez**. Residue bu klasörleri **adına göre
değil, içindeki kanıta göre** tanır: ne olduğunu, silersen tam olarak ne
olacağını ve kararın gerekçesini gösterir.

> **Bu bir Windows disk temizleyici değildir.** Genel disk temizliği, kayıt
> defteri/PATH onarımı, "PC hızlandırma" veya yer açma aracı değildir. Kapsamı
> yalnızca geliştirici ve AI araçlarının bıraktığı, Windows'un listelemediği
> artıklardır. **Hiçbir şey sen onaylamadan silinmez;** ilk tarama yalnızca
> listeler.

> **Kararlı sürüm: 3.0.1.** npm'de `latest` etiketi bu sürümü gösterir:
> `npx residue-cleaner scan`. Beta hattı (`0.3.0-beta.x`) kapatıldı; arayüz,
> kasa ve sözleşme artık kararlı sayılır. İlk çalıştırma hiçbir şeyi silmez;
> gerçek silmeden önce `--dry-run` ve kasa ile denemeniz önerilir.

## Neden Güvenilir?

Her işlem önce analiz edilir. Bağımlılıkları tespit edilir, onayınıza sunulur.
Siz isterseniz plana alır, kasanıza taşırsınız. Kontrol tamamen sizde olur.
Biz silme işlemi yapmayız... Siz temizliğinizi yaparsınız.

---

## Kapsam ve sınırlar

| Yapmaz | Neden |
|---|---|
| Kayıt defteri / PATH / "Program ekle-kaldır" girdilerine **varsayılan olarak** dokunmaz | Genel Windows bakımı değildir; ancak `residue env` ile **açık onay + yedek** alınarak PATH temizliği yapılabilir |
| Belgelerini, fotoğraflarını, projelerini "yer açmak için" silmez | Bu klasörler karar kapsamına girmez |
| Tanımadığı klasörü adına bakarak silmez | Kanıt yoksa "tanımlanamayan" der ve **yalnızca raporlar** |
| Model, ajan oturumu ve becerileri silmez | Senin verindir; silme hedefi üretilmez |
| Kendi verisini (günlük, yedek kasası) silmez | Araç kendi veri dizinini hedeflemez |

Aradığı şey tek bir sorunun kanıtlı cevabıdır: **"Bu klasör ne, silsem ne olur?"**

---

## 30 saniyede başla

1. **Node.js 22.6 veya üzeri** kurulu olsun → [nodejs.org](https://nodejs.org) (LTS).
2. **PowerShell**'i aç: Başlat → `PowerShell` yaz → aç.
3. Şunu yaz ve Enter'a bas:

   ```powershell
   npx residue-cleaner scan
   ```

   Kalıcı kurulum istersen: `npm install -g residue-cleaner` → `residue scan`.
   Kaynaktan çalıştırmak istersen:
   `git clone https://github.com/omer-denen/residue-cleaner.git` →
   `cd residue-cleaner && npm install` → `node bin/residue.mjs scan`.

4. Araç geliştirici ve AI araçlarının bıraktığı klasörleri tarar; her birini
   **ne olduğu, silinirse ne olacağı ve gerekçesiyle** listeler. Ölçüm büyük
   klasörlerde birkaç dakika sürebilir; `Ctrl+C` ile durdurabilirsin.
5. Kasaya taşımak istediklerini seç → `residue clean` → planı oku →
   orta/yüksek riskte `TASI` yaz → onayla. Kalıcı silme yalnız kasa
   öğelerinde (`residue vault purge --id <kasa-id>`) ve `BOŞALT`
   onayıyla yapılır.
6. Terminal yerine tarayıcıyı tercih edersen: `residue ui --web`.

Varsayılan mod **aracın kendi kasası**dır; yanlış karar verirsen geri
alabilirsin (`residue undo --restore`).

> **3.0.0 notu:** Kalıcı silme artık **yalnız kasa öğelerinde** yapılır
> (`residue vault purge`); yol üzerinde doğrudan silme modu kaldırıldı.
> Tarayıcı arayüzü (`residue ui --web`), proje ekranı, PATH/ortam planı,
> bağımlılık grafiği, planlı kasa temizliği ve denetim geçmişi bu sürümde.
> Arayüz karar vermez: listeler, toplamlar, onay ifadeleri ve planlar motordan
> gelir. Silme iki aşamalıdır.
>
> **2.0.0 notu:** Proje yeniden adlandırıldı: **Residue** (npm paketi
> `residue-cleaner`, komut `residue`). Veriler (kasa, günlük)
> `%LOCALAPPDATA%\residue` altında yaşar.

### Hiç terminal kullanmadıysan

- `node --version` yaz; `v22.6.0` veya üzeri değilse nodejs.org'dan LTS kur.
- `npx residue-cleaner scan` ilk çalıştırmada paketi indirir; birkaç saniye sürer.
- `npx residue-cleaner` komut listesi ve yardım metnini gösterir.
- Hiçbir şeyi silmek zorunda değilsin; `residue clean --dry-run` yalnızca
  planı gösterir.

---

## Tarayıcı arayüzü

Terminal yerine tarayıcıda çalışmak istersen:

```powershell
residue ui --web
```

- Sunucu **yalnızca `127.0.0.1`** üzerinde açılır; ağdan erişilemez.
- Her başlatmada yeni bir token üretilir. Token `HttpOnly + SameSite=Strict`
  çerezle taşınır; **adres çubuğunda görünmez**.
- Ekranlar: **Genel Bakış**, **Disk**, **Plan/Onay**, **Projeler**,
  **Araçlar**, **PATH & Ortam**, **Graf**, **Planlar**, **Kasa**, **Ayarlar**.
- Arayüz karar vermez: hangi kümenin listeleneceği, seçilebilirlik, toplamlar
  ve onay ifadeleri (`TASI`, `SIL`, `BOŞALT`, `TEMİZLE`, `PLANLA`) karar
  motorundan gelir. Tarayıcı silinecek **yol göndermez**.
- Silme ve plan yürütme yine **iki aşamalıdır**: önce plan, sonra yazılı onay.
  Yüksek riskli hedefler ayrıca işaretlenir; `--yes` bu adımı atlayamaz.
- **Klavye:** `/` aramaya odaklanır, `?` kısayol listesini açar, `Esc` kapatır;
  bölümler arasında ok tuşlarıyla gezinilir. `Tab`, `Enter` ve `Space` ile
  satır seçimi ve ayrıntı açma yapılabilir. "İçeriğe geç" ve "Listeye geç"
  bağlantıları uzun ekranlarda doğrudan içeriğe götürür.
- **Projeler** ekranı salt okunurdur: proje kaynağı hiçbir zaman silme hedefi
  olmaz; yalnız bağımlılıklar, lockfile hash'i ve yeniden kurulum tarifi
  raporlanır.
- **Güncelleme kontrolü kapalıyken hiçbir ağ isteği yapılmaz.** Açtığında
  yalnızca npm registry'deki sürüm numarası sorulur; telemetri yoktur.

> Arayüz, `residue api` ile açılan başsız API'nin üzerinde çalışır. API'yi
> yalnızca kendi araçlarına bağlamak istersen `residue api --port 4321`
> kullanabilirsin; arayüz sunmaz.

---

## AI kod araçları kullanıyorsan

> **AI araçlarında yeniysen** — ilk kez bir ajan veya model kurduysan — bu
> bölüm tam sana göre. Kıdemli bir geliştirici olsan da AI araçlarına yeni
> başlamış olabilirsin; fark etmez.

AI kod araçları arka planda çok şey indirir: model dosyaları, GPU kütüphaneleri,
Python ortamları, paket önbellekleri, ajan oturumları ve becerileri. Bunlar
"Program ekle/kaldır" listesinde görünmez; hangisinin yeniden indirilebilir,
hangisinin **senin verin** olduğunu bilmek zordur.

| AI tarafında ne var? | Residue ne yapar? |
|---|---|
| Ajan oturumları, beceriler, hafıza | **Korur.** Kullanıcı değeridir; silme hedefi üretmez. |
| Ajan çalışma alanındaki eklenti bağımlılıkları | **Raporlanır.** Yeniden kurulabilir; beceri ve plan dosyaları korunur. |
| Model dosyaları | **Korur.** Yalnız kullanılamayan GPU artıkları aday olur; CPU modelleri kalır. |
| GPU kütüphaneleri | Kullanılmadığı kanıtlanırsa aday olur; yoksa dokunmaz. |
| Python / conda ortamları | Eski veya atıl olanları **raporlar**; projeye bağlı olanlar korunur. |
| Paket önbellekleri | Yeniden indirilebildiği için güvenli aday. |
| Kullanılmayan CLI araçları | Kaldırma **planı** çıkarır; kendiliğinden kaldırmaz. |

### Basit sözlük

| Terim | Ne demek? |
|---|---|
| **Önbellek** | Tekrar indirilebilen dosyalar; silinince yeniden oluşur. |
| **Model** | AI'ın "beyni" olan büyük dosya; yeniden indirmek GB'larca olabilir. |
| **Ortam** | Bir projenin Python paketlerinin izole kurulumu. |
| **Ajan oturumu / beceri** | Sohbet geçmişi ve öğrenilmiş beceriler — **senin verin**. |

> Kural: **Ajan verisi, beceri ve modeller asla otomatik silinmez.** Yalnız
> yeniden üretilebilir önbellekler ve kanıtla "kullanılamaz" olduğu gösterilen
> parçalar aday olur.

---

## Ne bulur, neye dokunmaz?

**Bulur (aday gösterir):**

| Kategori | Örnek |
|---|---|
| Paket önbellekleri | npm, NuGet, conda, uv |
| Yorumlayıcı ortamları | `.venv`, conda ortamları |
| Model depoları | ONNX / GGUF dosyaları |
| GPU artıkları | kullanılmayan CUDA kütüphaneleri |
| Güncelleyici artıkları | updater klasörleri, eski sürümler |
| CLI / ajan artıkları | kullanılmayan araçlar |

**Dokunmaz:**

| Dokunmaz | Neden |
|---|---|
| Belgeler, fotoğraflar, projeler | taranmaz |
| Uygulama ayarları | yalnız önbellek klasörleri hedeflenir |
| Ajan oturumları ve becerileri | kullanıcı değeri taşır |
| Git tarafından takip edilen dosyalar | sürüm kontrolündeki dosya asla silinmez |
| Sanal diskler | yalnız raporlanır |
| SDK kurulumları | yalnız raporlanır |
| Aracın kendi veri dizini | günlük ve yedek kasası orada yaşar |

---

## Proje taraması: kendi projenin artıkları

Bir projenin içindeki `node_modules`, `.venv`, `dist` gibi artıkları görmek
istersen taranacak klasörü sen seçersin:

```bash
residue scan --root C:\projeler\uygulamam
```

Bu modda:

- Sonuçlar **salt rapordur**: hiçbir silme hedefi üretilmez.
- `.git` klasörü taranmaz; Git tarafından **takip edilen (tracked)** dosyalar
  hedef olamaz. Yalnız untracked veya `.gitignore` içindeki yollar değerlendirilir.
- Proje taraması, sisteminizin 24 saatlik tarama önbelleğini değiştirmez.

---

## Neden güvenli?

- **Kanıt:** her kararın yanında "bunu neden öneriyorum" yazar; kanıt yetersizse
  araç "tanımlanamayan" der ve yalnızca raporlar.
- **İki aşama:** önce plan, sonra yazılı onay. Kasaya taşıma `TASI`,
  kalıcı silme `SIL`; `--yes` bunu atlayamaz.
- **Kasa:** varsayılan mod; silinenler aracın kendi kasasına taşınır ve geri alınabilir.
- **Journal:** her yıkıcı adım önce yazılır; yarım kalan işlem `residue recover` ile raporlanır.
- **Kanıt ağacı:** her öneri gözlem → kanıt → iddia zinciriyle açıklanır.
- **Bağımlılık grafiği:** sert/aktif bir bağımlılık kopacaksa CLI kaldırma planı engellenir.
- **Ortam değişkenleri:** hassas değerler maskelenir; yazma yalnız `env --clean --apply` + yedek + yazılı onayla yapılır.
- **Hedefli silme:** klasörün tamamı değil, yalnız güvenli kısım silinir.
- **Git farkındalığı:** tracked dosya hedef olamaz; proje taramaları salt rapordur.
- **Son savunma hattı:** silme katmanı, korunan bir yolun üstünü veya aracın
  kendi veri dizinini hedef almışsa silmeyi reddeder.
- **Yerel ve açık:** araç yalnızca bu bilgisayarda çalışır; telemetri yoktur,
  kod MIT lisanslıdır.

---

## Sık sorulanlar

**Sadece bakmak istiyorum, silmek istemiyorum.**
İncele; hiçbir şey silinmez. Terminalde `residue clean --dry-run` yalnızca
planı gösterir.

**AI ajanımın sohbetleri, becerileri veya modeli silinir mi?**
Hayır. Ajan oturumları ve beceriler kullanıcı verisi sayılır. Modeller korunur;
yalnız kanıtla "kullanılamayan" GPU artıkları aday olur.

**Projemin içindeki `node_modules` silinir mi?**
Proje taraması (`--root`) hiçbir zaman silme hedefi üretmez; yalnız raporlar.
Git tarafından takip edilen dosyalar zaten her koşulda korunur.

**Yanlış sildim.**
Kasadan geri al: `residue undo --restore`.

**Tarayıcı arayüzünü nasıl açarım?**
`node bin/residue.mjs ui --web` yaz; tarayıcı `127.0.0.1` üzerinde açılır.
Kapatmak için terminalde `Ctrl+C` yeterlidir.

**Arayüzde "Geçersiz token" görüyorum.**
Sunucu her başlatmada yeni bir token üretir; eski sekme veya adres geçersiz
olur. Terminali kapatıp `residue ui --web` ile yeniden aç.

**Bağımsız bir aracı silmeden devre dışı bırakabilir miyim?**
Evet. Karantinaya al: `residue quarantine <ad>`. Shim kasaya taşınır (komut
PATH'ten düşer), verilerin yerinde kalır; geri alma adımları kasaya yazılır.

**Tarama neden uzun sürüyor?**
Diskteki en büyük klasörlerin boyutu ölçülüyor. İstediğin an
**Taramayı iptal et** ile durdurabilirsin.

**Node yok / sürüm eski.**
[nodejs.org](https://nodejs.org) LTS kur; `node --version` ile doğrula.

**Windows dışında çalışır mı?**
Şu an yalnızca Windows destekleniyor.

**Antivirüs uyarı verdi.**
Araç dosya silebilir. Önce `residue clean --dry-run` ile plana bak; hiçbir
şey silinmez.

**Verilerim bir yere gönderiliyor mu?**
Hayır. Her şey yerel makinede çalışır.

**Nasıl kaldırırım?**
`npm uninstall -g residue-cleaner`. `npx` ile denediysen kurulum kalmaz.

---

## Kurulum

**Gereksinimler:** Windows 10/11 ve Node.js 22.6+ ([nodejs.org](https://nodejs.org)).

```powershell
# 1) Kurmadan denemek icin
npx residue-cleaner scan

# 2) Kalici kurulum (komut: residue)
npm install -g residue-cleaner
residue scan

# 3) Kaynaktan calistirma
git clone https://github.com/omer-denen/residue-cleaner.git
cd residue-cleaner && npm install
node bin/residue.mjs scan
```

**Sürüm ve kopya kontrolü.** `npx` indirdiği paketi önbellekte tutar ve
kendiliğinden güncellemez; bu yüzden eski bir sürüm açılabilir. Kalıcı
kullanımda `npm install -g residue-cleaner@latest`, tek seferlik denemede
`npx residue-cleaner@latest scan` yazın. Ayrıca herhangi bir üst klasörde
`-g` olmadan kurulmuş bir kopya varsa `npx` önce onu çalıştırır. Hangi
kopyanın çalıştığını `residue doctor` söyler: **Kurulum kopyası** satırı
gölge kopyanın yolunu ve onu kaldıran komutu gösterir.

Tarama, plan ve kasa için **yönetici hakkı gerekmez**. Yalnızca makine geneli
ortam değişkeni/PATH yazımı (`residue env --clean --apply`) yönetici ister.

**Kaldırma:** `npm uninstall -g residue-cleaner` (yalnız `npx` kullandıysan
kurulum kalmaz). Kaynaktan çalıştırdıysan depo klasörünü silmek yeterlidir.
Araç verileri `%LOCALAPPDATA%\residue` altındadır (günlükler, tarama
önbelleği, yedek kasası). **Araç bu dizini kendi taramalarında hedef olarak
göstermez ve silmez**; yedek kasası orada yaşadığı için elle de silmemek
gerekir.

| Sorun | Çözüm |
|---|---|
| "Geçersiz token" | API sunucusu her başlatmada yeni token üretir; eski adresi kapat |
| Terminal arayüzü bozuk | Gerçek bir terminal (PowerShell / Windows Terminal) kullan |
| Windows dışı sistem | Şu an yalnızca Windows desteklenir |

---

## Kullanım

```bash
residue                     # komut listesi ve yardım
residue scan                # terminalde tara ve listele
residue scan --root .       # proje içi artıkları yalnız raporla
residue clean --dry-run     # yalnızca planı göster, hiçbir şey silme
residue clean               # iki aşamalı onay + kasa (geri alınabilir)
residue undo --restore      # kasadan geri al
residue repair --dry-run    # bozuk / yarım kurulumları göster
residue repair              # onar (ONAR onayı; çıktı canlı akar)
residue quarantine <ad>     # bağımsız aracı silmeden kasaya taşı (KARANTINA onayı)
residue env                 # PATH / ortam değişkeni analizi (salt okunur)
residue env --clean         # PATH temizlik planı (yazmaz)
residue project [dir]       # proje bağımlılıkları + yeniden kurulum tarifi
residue graph               # CLI bağımlılık grafiği; --what-if <ad>
residue schedule            # planlı kasa temizliği (günlük/haftalık)
residue vault               # kasa envanteri / saklama / kalıcı silme
residue audit               # denetim geçmişi (salt okunur)
residue recover             # yarım kalan işlemleri raporla
residue ui                  # terminal arayüzü (Ink; gerçek terminal gerekir)
residue ui --web            # tarayıcı arayüzü (dist/web; 127.0.0.1)
residue api                 # başsız HTTP/SSE API (arayüz yok; 127.0.0.1)
```

Daha fazlası için: `residue help`

---

## Güncelleme

Otomatik güncelleme kontrolü **varsayılan olarak kapalıdır**. Ayarlar
ekranından `Günlük` veya `Haftalık` seçilirse yalnızca npm registry'deki
sürüm numarası sorulur; kapalıyken **hiçbir ağ isteği yapılmaz**.
Manuel güncelleme:

```powershell
npm install -g residue-cleaner@latest   # npm kurulumu
```

Kaynaktan çalıştırıyorsan: `git pull` → `npm install`.

- Kaynak: <https://github.com/omer-denen/residue-cleaner>

Otomatik sürüm kontrolü **kapalıdır** (varsayılan: hiçbir ağ isteği yapılmaz).
Açmak istersen Ayarlar ekranındaki **Güncelleme kontrolü** seçeneğini
`Günlük` veya `Haftalık` yap.

---

## Lisans

MIT — bkz. [LICENSE](LICENSE).

Residue hiçbir veriyi dışarı göndermez; tüm işlemler yerel makinede
çalışır. Silme kararı her zaman kullanıcıya aittir.
