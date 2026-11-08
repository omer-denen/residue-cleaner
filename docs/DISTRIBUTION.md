# Dagitim kanallari

> Bu belge **hangi kanaldan nasil kurulur** ve **hangi kanal neden kapali**
> sorularini kanitla yanitlar. Karar mercii `AGENTS.md`'dir.

## 1. Durum tablosu

| Kanal | Durum | Kapi |
|---|---|---|
| npm (`residue-cleaner`) | **yayinda** (birincil kanal) | — |
| zip / elle cikarma | **calisiyor** | `bin/residue.cmd` |
| scoop | **kod hazir, yayina kapali** | sonraki npm yayini |
| winget | **ENGELLI** | gercek `.exe` gerekir (bkz. §5) |

Scoop manifesti ancak npm tarball'i `bin/residue.cmd` **icerdiginde**
uretilir. Bugun yayindaki surumler (2.2.0, 0.3.0-beta.1) bu dosyayi
icermiyor; dosya bu commit ile depoya girdi, dolayisiyla **bir sonraki
yayinla** kanal acilir. Bu bilincli bir kapidir: manifest "muhtemelen
calisir" diye yazilmaz (AGENTS kural 20 / UX-043).

## 2. Kanit: scoop `.mjs` dosyasini baglayamaz

Scoop shim uretimi (`lib/core.ps1` -> `function shim`) yalnizca su
uzantilari tanir:

```
.exe /.com   -> shim.exe + .shim
.bat /.cmd   -> shim.cmd ( "@<yol>" %* )
.ps1         -> shim.ps1 + shim.cmd
.jar         -> java -jar
.py          -> python
<diger>      -> bash/cygwin varsayimi  ("bash -c ...")
```

`.mjs` son `else` dalina duser; bash/cygwin olmayan bir Windows'ta shim
calismaz. Bu yuzden `bin/residue.mjs` **dogrudan** `bin` alanina
yazilamaz. Pakette `bin/residue.cmd` sarmalayicisi bulunur ve manifest
`bin` alanlari ona baglanir:

```json
"bin": [
  ["bin\\residue.cmd", "residue"],
  ["bin\\residue.cmd", "residue-cleaner"]
]
```

`bin/residue.cmd` `node` yoksa acik hata verir (`where node` kontrolu,
cikis kodu 127) ve `node "%~dp0residue.mjs" %*` ile devam eder.

## 3. Kanit: winget `.cmd` dosyasini portable olarak kabul etmiyor

Deney (`winget validate`, manifest v1.10.0, `InstallerType: zip` +
`NestedInstallerType: portable`):

```
Manifest Error: The file type of the referenced file is not allowed.
[RelativeFilePath] Value: residue.cmd
```

Winget'in `portable` gomulu kurulumu yalnizca **yurutulebilir dosya**
kabul eder; `.cmd`/`.mjs` reddedilir. Dolayisiyla winget kanali, npm
tarball'i ile **acilamaz**: gercek bir `residue.exe` (Node SEA + esbuild
paketi) uretilmeden manifest yazmak yanlis olur.

## 4. Kanit: shim zinciri uctan uca calisiyor

Scoop'un yazdigi shim bicimi birebir taklit edilerek olculdu:

```bat
@rem <app>\package\bin\residue.cmd
@"<app>\package\bin\residue.cmd" %*
```

```
$ cmd /c "scratch\dist-sim\shims\residue.cmd --version"
0.3.0-beta.1
shim_exit=0
```

Satir sonu dayanikliligi da olculdu (depo `.gitattributes` -> `eol=lf`,
yani `.cmd` dosyasi LF olarak saklanir): LF kopyada hem normal calisma
(`0.3.0-beta.1`, cikis 0) hem de "node yok" dali
(`Residue needs Node.js 22.6 or newer`, cikis 127) dogru davrandi.

Manifest uretimi de yerel `npm pack` ciktisi uzerinde dogrulandi:

```
$ npm run dist:verify
Yerel tarball: 145 dosya — scoop icin hazir (bin/residue.cmd pakette).

$ npx tsx scripts/dist-manifest.mjs --tarball scratch\dist-sim\residue-cleaner-0.3.0-beta.1.tgz --dry-run
Kaynak: yerel tarball ...
  version 0.3.0-beta.1
  hash    43b32ba7d0056cf1eb7eacecc0e3a99f86f8f657fd52aed6abcd74a3ff178e28
  bin     bin\residue.cmd -> residue, residue-cleaner
```

Yayindaki surum icin kapi **kapali** kalir ve sebebini yazar:

```
$ npm run dist:scoop
residue-cleaner@0.3.0-beta.1 tarball'i scoop icin HAZIR DEGIL.
Eksik: package/bin/residue.cmd
...
Manifest yazilmadi.   (cikis kodu 1)
```

## 5. Yayin akisi

1. **Yayin oncesi kapi:** `npm run dist:verify` — paketlenecek tarball
   `bin/residue.cmd` iceriyor mu? (ag yok, `npm pack --dry-run --json`)
2. **Yayin:** `npm version patch` -> `npm publish --tag beta`
3. **Manifest:** `npm run dist:scoop` -> `packaging/scoop/bucket/residue.json`
   (surum + sha256 + url kayit defterinden okunur, `dist.integrity` ile
   karsilastirilir; uyusmazsa manifest yazilmaz)
4. **Bucket:** ayri bir depo (`scoop-residue`) acilir, manifest
   `bucket/residue.json` olarak konur:
   ```powershell
   scoop bucket add residue https://github.com/<kullanici>/scoop-residue
   scoop install residue
   ```
5. `checkver`/`autoupdate` npm kayit defterine bakar; yeni surum
   yayinlandiginda `scoop update residue` manifesti tazeler.

### Surum hatti

Varsayilan `--tag beta` (calisma hatti). Kararli surum yayinlandiginda:

```powershell
npm run dist:scoop -- --tag latest
```

`checkver` de o etikete bakar (`https://registry.npmjs.org/residue-cleaner/<tag>`),
boylece `latest` hattina gecince manifest kendiliginden orayi izler.

## 6. Winget kanali (Kademe 1 — yapilmadi)

Acildiginda gerekenler:

- `residue.exe` (Node SEA: esbuild ile tek JS + gomulu node) — CLI'lık korunur
- Zip artefakti + `InstallerType: zip`, `NestedInstallerType: portable`,
  `NestedInstallerFiles[].RelativeFilePath: residue.exe`,
  `PortableCommandAlias: residue`, `Dependencies: Microsoft.Nodejs` **gerekmez**
  (node gomulu oldugu icin)
- `winget validate` kapisi gecmeden PR acilmaz

Bugun bu artefakt yok; bu yuzden winget manifesti **yazilmadi**.
