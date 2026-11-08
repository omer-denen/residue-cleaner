# HANDOVER — 2026-11-08c — kurulum golgesi + 3.0.1

> Devir notu. Bir onceki: `docs/HANDOVER-2026-11-08b.md` (3.0.0 kararli surum).
> Test **852/852** · typecheck temiz · smoke + package smoke temiz ·
> `dist:verify` 147 dosya. **E2E bu oturumda calistirilmadi** (degisiklik
> sunucu/web yoluna dokunmuyor); son kosu 3.0.0 yayinindan once 123/123.

---

## 1. Kullanici bulgusu

> "node.js komut penceresinden basina npx yazmadan web arayuzu calismiyor.
> yazdigim zaman da eski versiyon aciliyor."

Ilk bakista paket sorunu gibi gorundu; degildi.

| Gozlem | Deger |
|---|---|
| `npm view residue-cleaner dist-tags` | `latest: 3.0.0` (o an) |
| `npm ls -g --depth=0` | `residue-cleaner@3.0.0` |
| `residue --version` | `3.0.0` |
| `npx --yes residue-cleaner --version` | **`2.2.0`** |
| `where.exe residue-cleaner` | yalniz `%APPDATA%\npm\residue-cleaner.cmd` |

Kok neden diskteki **ikinci kopya**:

```
C:\Users\Code\package.json          (21.10.2026 21:44)
  { "dependencies": { "opencode-windows-x64": "^1.18.21",
                      "residue-cleaner": "^2.2.0" } }
C:\Users\Code\node_modules\residue-cleaner   -> 2.2.0
C:\Users\Code\node_modules\.bin\residue*     -> o kopyaya bagli shim'ler
```

`npm exec`/`npx` cwd'den yukari yurur ve **ilk buldugu** `node_modules/.bin`
girdisini calistirir. Home dizini (`C:\Users\Code`) altindaki her klasor
(`%TEMP%` dahil) o projenin altinda oldugu icin npx hep 2.2.0'a cikiyordu.
Global paket kaldirilip yeniden kurulsa bile sonuc degismiyordu — cunku npx
global kopyaya hic bakmiyordu.

**Ikinci kanit (npx onbellegi):** `_npx` icinde 21.10.2026 14:54'te kurulmus
`residue-cleaner` girdisi vardi; o gun `latest` 2.0.1 idi ve 2.2.0/3.0.0
yayinlandiktan sonra bile 2.0.1'de kaldi. Yani npx onbellegi surumu kendisi
guncellemiyor. Ayni gun `npx residue-cleaner@latest` (bos onbellekle) 3.0.0
kuruverdi — fark yalnizca onbellekti.

**Ucuncu kanit (zamanlama):** 3.0.0 bugun **16:01 UTC (19:01 TSİ)** yayinlandi.
Ondan onceki her kurulum dogru sekilde 2.2.0 getiriyordu; yayin sonrasi
~4 dakika tarball 404 dondu (npm depolama gecikmesi).

---

## 2. Bu makinede yapilan duzeltme (kullanici bazinda)

1. `cd C:\Users\Code; npm uninstall residue-cleaner` → 46 paket kaldirildi;
   `package.json`da yalniz `opencode-windows-x64` kaldi (bu pakete dokunulmadi,
   `C:\Users\Code\node_modules` ~171 MB olarak duruyor).
2. Bayat `_npx` girdileri silindi (2.0.1 / 2.2.0 / beta / 3.0.0).
3. Dogrulama: `npx` (TEMP) 3.0.0 · `npx` (home) 3.0.0 · `residue` 3.0.0.
4. Temiz makine benzetimi (global shim PATH'ten cikarildi, bos npm onbellegi):
   `npx --yes residue-cleaner --version` -> **3.0.0** (yeni kullanicida sorun yok).

---

## 3. Urun duzeltmesi (commit `5f266f7`)

| Dosya | Icerik |
|---|---|
| `src/core/install-shadow.ts` | `InstallShadowReport` — saf TS karar sinifi: kopya kapsami (`global`/`local`/`npx`/`path`), surum iliskisi (`same`/`older`/`newer`/`unknown`), `summary()` + `advice()`. Surum okunamazsa `unknown`; uydurma yok. |
| `src/util/install-probe.ts` | Kanit toplayici (SALT OKUNUR): cwd atalari, PATH girdileri, `%LOCALAPPDATA%\npm-cache\_npx`. BOM'lu `package.json` toleransi. |
| `src/commands/doctor.ts` | Yeni kontrol **"Kurulum kopyasi"**: golge varsa kapsam + surum, altinda `npm uninstall <paket> --prefix "<dizin>"` / `npm install -g <paket>@latest` / `npx <paket>@latest` komutlari. Ayrica uyari varken "Tum kontroller gecti" diyen yanlis rapor duzeltildi (`N uyari var; kritik sorun yok`). |
| `tests/install-shadow.test.ts` | 15 test: saf karar (same/older/newer/unknown, tekrar eleme, calisan kopya dislama, prerelease sirasi, ozet/tavsiye) + gecici dizinde gercek kanit (ata zinciri, PATH, shim-only, `_npx`, BOM). |
| `README.md` / `README.en.md` | Kurulum notu: npx onbellegi kendiliginden guncellenmez; kalici kurulumda `@latest`; ust klasordeki `-g`siz kopya npx'i golgeler; `residue doctor` gosterir. |
| `CHANGELOG.md` | `[3.0.1]` — kisa, teknik detaysiz (kural 7). |
| `package.json` / lock | surum **3.0.1**. |

Gercek cikti (gecici klasorde 2.2.0 kopyasi ile):

```
! Kurulum kopyasi   3 golge kopya: v2.2.0 yerel proje, v3.0.0 global kurulum,
                    v3.0.0 npx onbellegi (calisan v3.0.1)
-> Yerel kopyayi kaldir: npm uninstall residue-cleaner --prefix "…\shadow-check\proje"
-> npx kullanirken surum belirt: npx residue-cleaner@latest <komut>
```

Kopya yoksa: `v Kurulum kopyasi  Golge kopya yok (calisan: v3.0.1)`.

---

## 4. Yayin (3.0.1)

Yayin oncesi kapilar bu oturumda yeniden kosuldu:

```
npm run typecheck        temiz
npm test                 852/852      (837 -> 852)
npm run smoke            SMOKE TEMIZ
npm run smoke:package    PAKET SMOKE TEMIZ
npm run dist:verify      147 dosya, scoop icin hazir
```

`npm publish` -> `residue-cleaner@3.0.1`, 147 dosya / 517.4 kB,
shasum `5e539df3dd2bc31b22f704eefb1fb1a6fe495fb5`.
Registry kaydi: `2026-11-08T20:28:20.145Z`.

**Yayin tuzagi (tekrar etti):** tarball birkac saniyede 200 oldu ama packument
(dist-tags) **~6 dakika** `3.0.0` gosterdi. Bu arada:

- `npm view residue-cleaner@3.0.1` -> `E404`,
- `npm i -g residue-cleaner@latest` -> `notarget` (istemci onbellegi),
- `npm i -g residue-cleaner@latest --prefer-online` -> **3.0.1** (cozum).

Sonrasinda:

- `packaging/scoop/bucket/residue.json` -> 3.0.1, sha256
  `da79f231553de12b620105a82278725a97176eddd7829d6c8c283f0697140b6b`, 147 dosya
  (commit `79f68a1`).
- Global kurulum 3.0.1; `npx residue-cleaner --version` 3.0.1.
- `residue doctor` (global) -> `Golge kopya yok (calisan: v3.0.1)`; once yayin
  sirasinda kalan `_npx` 3.0.0 girdisi yakalanip temizlendi — kontrolun
  gercek islevi.
- `residue ui --web --no-browser --port 4495` -> HTTP 200 (web arayuzu aciliyor).
- `main` + tag `v3.0.1` gonderildi (`a4c37c0…`).

---

## 5. Degismezler / dikkat

- `install-probe` **salt okunur**: hicbir kopya silinmez, yalniz yol ve surum
  okunur. Silme/komut onerisi kullaniciya metin olarak verilir.
- Surum karsilastirmasi `core/semver.ts` tek kaynagindan gelir; ad-hoc
  karsilastirma eklenmedi.
- Karar motorda (`core/install-shadow.ts`), kanit toplama util'de, gosterim
  komutta (kural 11/18). `src/core` icinde node builtin yok.

## 6. Acik isler

| Konu | Durum |
|---|---|
| `scoop-residue` bucket deposu | Manifest hazir (`packaging/scoop/bucket/residue.json` 3.0.1); ayri depo acilip icine konacak |
| Winget kanali | Kapali — portable `.cmd` reddediliyor; gercek `residue.exe` (Node SEA) gerekir |
| `C:\Users\Code\package.json` + `node_modules` (171 MB) | Kullanici karari bekliyor: `opencode-windows-x64` hala orada; home dizininde npm projesi tutmak npx icin risk |
| Doktor uyari sayaci | Uyari varken artik "N uyari var" yaziyor; E2E/smoke bu metni kontrol etmiyor |
| E2E | Bu oturumda kosulmadi (sunucu kodu degismedi); bir sonraki surum oncesi tam kosu |

## 7. Kontrol listesi

```powershell
npm view residue-cleaner dist-tags --json      # latest: 3.0.1
residue --version                              # 3.0.1
residue doctor                                 # Kurulum kopyasi: Golge kopya yok
npm run typecheck && npm test                  # 852/852
npm run dist:verify                            # 147 dosya
git ls-remote --tags origin v3.0.1             # tag uzakta
```
