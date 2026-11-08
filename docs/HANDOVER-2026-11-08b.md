# HANDOVER — 2026-11-08b — 3.0.0 kararlı sürüm

> Devir notu. Bir önceki: `docs/HANDOVER-2026-11-08.md` (beta kapanışı).
> Test **837/837** · E2E **123/123 (iki koşu üst üste)** · typecheck temiz.

---

## 1. Ne yapıldı

**3.0.0 kararlı sürümü yayınlandı** (kullanıcı kararı, 08.11.2026).

| Karar | Sonuç | Gerekçe |
|---|---|---|
| Sürüm numarası | **3.0.0** | Registry'de `latest` 2.2.0'dı; 0.3.0/1.0.0 yayınlamak sayısal terslik yaratır (2.2.0 > 1.0.0) ve eski kurulumlara güncelleme bildirimi gitmez. 2.x hattının devamı + kırıcı değişiklik (yol üzerinde kalıcı silme kaldırıldı). |
| Kısmi 5 satır | Kabul | `SEC-06`, `SEC-08`, `SCHED-03`, `ENV-03`, `ENV-04` yalnız elle/yönetici doğrulaması isteyen satırlar; eksik özellik değil. |

Yayın kapıları (hepsi temiz):

```
npm run typecheck        -> temiz
npm test                 -> 837/837
npm run e2e              -> 123/123  (iki kez üst üste)
npm run smoke            -> SMOKE TEMIZ
npm run smoke:package    -> PAKET SMOKE TEMIZ
npm run dist:verify      -> 145 dosya, "scoop için hazır"
```

Paket: **145 dosya / 512.7 kB**, tag `v3.0.0`, sürüm commit'i `0ee6cf3`.
`README.md` + `README.en.md` + `CHANGELOG.md` kararlı sürüme hazırlandı
(`8052a15`): beta bandı kaldırıldı, kurulum `npx`/global npm önceliğine
alındı, "npm kurulumu yok" çelişkisi silindi, "yönetici hakkı gerekmez"
ifadesi makine geneli PATH yazımı için koşullandırıldı (kural 8).

---

## 2. E2E izolasyon hatası (yayın öncesi bulundu ve düzeltildi)

Beta kapanışında "123/123 temiz" kaydı vardı; bu oturumda ilk tam koşu
**108/111** verdi. Teşhis:

**Belirti:** `WEB-05 sahte araç envanterde` ve `WEB-07 düğümler ekranda`
düşüyor; ikisi de tek başına koşunca geçiyordu.

**Kanıt (düşen koşunun satır metinleri):**

```
dsh @deepseek-ai/dsh@0.1.1-rc.2 npm global Atıl 45 gün 194 MB
opencode @opencode/cli@2.2.6 npm global Bilinmiyor 0 gün 507 MB
pi @earendil-works/pi-coding-agent@1.4.0 npm global Bilinmiyor 11 gün 107 MB
npm npm@12
```

Yani senaryo **gerçek makinenin** küresel araçlarını listeliyordu, `demo-tool`
yoktu. Üç ayrı sızıntı vardı:

1. **`npm prefix -g`** — `src/core/cli-inventory.ts:271` önce
   `NPM_CONFIG_PREFIX`'e bakar; tanımlı değilse `npm.cmd prefix -g` çalışır ve
   **gerçek** `%APPDATA%\npm` döner (env override'ı npm'in kendi çözümlemesini
   bağlamıyor). Harness bu değişkeni set etmiyordu.
2. **`PATH` mirası** — çocuk süreç gerçek `PATH`'i alıyordu; gerçek shim'ler
   (dsh/opencode/pi) envantere giriyordu.
3. **Port seçimi** — `PORT_BASE + rastgele(60)`; önceki senaryonun sunucusu
   henüz ölmeden aynı port seçilirse `waitForServer` **eski sunucuya** 200
   alıyordu (belirti: `WEB-14 tarama başlamadı: "Tarama zaten suruyor"`).

**Düzeltme** (`e2e/harness.mjs`, `e2e/scenarios/05`, `07`, commit `06b1908`):

- `NPM_CONFIG_PREFIX` + `npm_config_prefix` = harness'in geçici `Roaming\npm`
- sandbox `PATH`: geçici npm dizini + node + `System32` + PowerShell + Windows
- port işletim sisteminden istenir (`listen(0)`), `stop()` portun kapandığını
  doğrular; `waitForServer` cevap veren sunucunun **kimliğini** `/api/meta`
  içindeki `home` ile karşılaştırır ve `server.exitCode` erken kapanmayı yakalar
- senaryolar metni bekler (`waitText`), "ilk satır geldi" yarışı kaldırıldı

Sonuç: envanter **1 araç** (`demo-tool`), graf **22 düğüm** — makine durumundan
bağımsız. İki ardışık tam koşu 123/123.

---

## 3. npm dağıtımı

`npm publish` → `+ residue-cleaner@3.0.0` (tag `latest`, 145 dosya).
Kayıt defteri doğrulaması: `dist-tags` → `{"latest":"3.0.0","beta":"0.3.0-beta.1"}`.

**Ölçülen aksaklık:** tarball (`residue-cleaner-3.0.0.tgz`) metadata göründükten
sonra **~4 dakika 404** döndü (npm depolama gecikmesi), sonra 200'e döndü.
Doğrulama: `npm pack residue-cleaner@3.0.0` → indi; `dist-tags`
`{"latest":"3.0.0","beta":"0.3.0-beta.1"}`. Tarball 404 dönerse yapılacak:
`npm dist-tag add residue-cleaner@2.2.0 latest` ile `latest` geri alınır
(indirme çalışır kalır); tarball yayına girince etiket 3.0.0'a döndürülür.

---

## 4. Dagitim kanallari (bu sürümle açılan kapı)

- **Scoop:** `3.0.0` tarball'i `bin/residue.cmd` içeriyor; `npm run dist:scoop
  -- --tag latest` manifesti üretir (`packaging/scoop/bucket/residue.json`).
  Kanıt: `dist:verify` → "145 dosya, scoop için hazır".
- **Winget:** **kapalı**. `winget validate` portable için `.cmd` reddediyor:
  `The file type of the referenced file is not allowed. [RelativeFilePath]
  Value: residue.cmd`. Açmak için gerçek `residue.exe` (Node SEA + esbuild)
  gerekir — Kademe 1. Ayrıntı: `docs/DISTRIBUTION.md`.
- **zip / elle çıkarma:** `bin/residue.cmd` pakette; LF/CRLF ve "node yok"
  dalı ölçüldü (çıkış 127 + açık mesaj).

---

## 5. Açık işler

| Konu | Durum |
|---|---|
| Winget kanalı (Kademe 1: `residue.exe`, Node SEA) | Planlı — tek dosya exe olmadan açılamaz |
| Scoop bucket deposu (`scoop-residue`) | Manifest hazır; ayrı depo açılıp `bucket/residue.json` konacak |
| `2.2.0` kaydı | Silinmedi/deprecate edilmedi; `latest` artık 3.0.0. İstenirse `npm deprecate` ile yönlendirilir |
| README rozeti | Tag `v3.0.0` push edilince güncellenir (shields.io tag okur) |

---

## 6. Kontrol listesi (yeniden doğrulama)

```powershell
npm view residue-cleaner dist-tags          # latest: 3.0.0
npm pack residue-cleaner@3.0.0              # tarball indirilebiliyor mu
npx residue-cleaner@3.0.0 --version         # 3.0.0
npm run typecheck && npm test               # 837/837
npm run e2e                                 # 123/123
npm run dist:verify                         # 145 dosya, scoop hazır
```
