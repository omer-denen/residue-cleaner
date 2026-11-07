# E2E kapisi (beta)

Tarayici uctan uca testleri **gercek sunucu + gercek tarayici** ile kosar.
Testler `npm test` icine dahil **degildir** (yavas ve tarayici gerektirir);
beta kapisinda ayrica kosulur.

## Gereksinimler

- `playwright-core` (devDependency; tarayici indirmez).
- Kurulu Microsoft Edge veya Chrome. Harness once `channel: 'msedge'`,
  olmazsa `chrome` dener.

## Kosma

```bash
npm run e2e              # 12 senaryo
npm run e2e -- 02        # yalniz eslesen senaryolar (dosya adi filtresi)
```

Cikis kodu 0 = tum kontroller temiz.

## Yalitim

Her senaryo icin `e2e/harness.mjs`:

1. Gecici bir veri dizini kurar (`LOCALAPPDATA` temp altinda degil, kendi
   `residue-e2e-*` klasoru) ve `LOCALAPPDATA`, `APPDATA`, `USERPROFILE`
   degiskenlerini oraya yonlendirir. Gercek kullanici verisine dokunulmaz.
2. Rastgele portta `residue ui --web --no-browser` baslatir.
3. Sahte disk fixture'i (`seedDisk`) uretir ve zamanlari 40 gun geriye alir
   (`backdate`), boylece "eski dosya" kurallari hedef uretebilir.
4. Headless Edge ile gezinir; konsol hatalarini ve 400+ yanitlari toplar.

## Kapsam (WEB maddeleri)

| Senaryo | Konu |
|---|---|
| `02-disk-scan` | canli tarama, iki adimli iptal, gecmiste "tamamlanmadi" (B20) |
| `03-plan-vault` | plan olusturma, yazili `TASI` duvari, kasaya tasima |
| `04-vault-restore` | geri yukleme, cakisma (`.restored-*`) |
| `05-tools-sil` | arac envanteri, kanit paneli, `SIL` duvari (calistirilmaz) |
| `06-env-clean` | PATH temizligi plani, `TEMIZLE` duvari (uygulanmaz) |
| `07-graph-whatif` | graf, dugum testi, what-if sonucu |
| `08-schedules` | plan kurali, `PLANLA` duvari, onizleme, silme |
| `10-keyboard` | klavye-only tur, `?` kisayol, `/` arama, rail roving tabindex |
| `11-screen-reader` | tek `main`/h1, adsiz dugme yok, canli bolge, ilerleme cubugu |
| `13-lang` | TR/EN gecisi, `lang` ozniteligi, kalicilik |
| `14-narrow` | 1100/780 px mizanpaj, cekmece, yatay tasma yok |
| `16-sse-resume` | SSE kopmasi, otomatik yeniden baglanma, sonuc tamamlanir |

## Bilinen sinirlar

- **WEB-07 "engellenen" ornegi** sandbox'ta uretilemez: engel, farkli gruba
  ait **sert** ve **aktif** gelen kenar ister; fixture'da gruplar
  `install:<kaynak>:<paket>` oldugu icin ayni kurulum muaf tutulur. Bu yol
  birim testleriyle dogrulanir.
- **WEB-05 / WEB-06** gercek kaldirma/temizlik **calistirmaz**; yalniz plan
  ve onay duvari sinanir. Kayit defteri ve kurulu araclar degismez.
- Iptal yarisi: tarama cok hizli biterse `POST /api/scan/<id>/cancel` 409
  donebilir. `02-disk-scan` bunu `seedBulk` ile kesinlestirir; harness 409'u
  beklenen catisma olarak yok sayar (diger 4xx/5xx hata sayilir).
- Senaryo dosyalari `.mjs`'dir; TypeScript sozdizimi (`as`, `!`) kullanilamaz.
