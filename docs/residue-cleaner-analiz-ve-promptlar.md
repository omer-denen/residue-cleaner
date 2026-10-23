# residue-cleaner: Kod Analizi ve Düzeltme Promptları

Bu dosya, `analyze.ts`, `classifier.ts`, `walker.ts` ve `discover.ts` dosyalarının
statik incelemesinin sonucudur. Ajan için yazılmıştır: bu dosyayı okuyan kişinin
önceki konuşmayı görmediği varsayılır.

## 0. Ajan için çalışma kuralları

- Önce ilgili bulguyu kodda **doğrula**, sonra düzelt. Bulgular statik okumadan
  çıkarıldı, hiçbiri çalıştırılarak doğrulanmadı. Doğrulanamayan veya yanlış çıkan
  bulguyu atla ve nedenini raporla.
- Her düzeltme için birim testi ekle (önce başarısız olan test, sonra düzeltme).
- Tek prompt = tek commit. Kapsam dışı yeniden düzenleme yapma.
- Uygulama adı sabit kodlama (classifier.ts başlığındaki kural). Karar, ada değil
  kanıta/türe göre verilir.
- Proje içi taramalar rapor modunda kalır, silme hedefi üretmez (AGENTS kural 9).
- Belirsizlik varsa güvenli tarafa (`ask` veya `report-only`) düş; asla tersine değil.
- Bu analizde **görülmeyen** dosyalar: `types.ts`, `longpath.ts`, `log.ts`, `git.ts`,
  `data-dir.ts`, `evidence-tree.ts`, `format.ts`. Bunlara dair varsayımlar aşağıda
  açıkça belirtilmiştir.

## 1. Proje ve dosya rolleri

residue-cleaner (eski adı CLICleaner): TypeScript ile yazılmış, Windows odaklı bir
araç. AI CLI araçlarının ve geliştirici araçlarının bıraktığı artıkları tarar, ne
olduklarını kanıta bakarak sınıflandırır ve güvenle silinebilecek kısımları önerir.

| Dosya | Rol |
|---|---|
| `discover.ts` | Taranacak kökleri bulur (nokta klasörleri, AppData), kendi veri dizinini korur, profilleri tanımlar |
| `walker.ts` | Bir klasörü özyinelemeli ölçer (bayt, dosya sayısı, uzantılar, büyük dosyalar) |
| `classifier.ts` | Bir klasörden **kanıt** toplar (`probeDir`): dosya türleri, işaretler, log sinyalleri |
| `analyze.ts` | Kanıttan mimari tür (archetype) ve karar (`recommend` / `ask` / `report-only`) üretir, silme hedeflerini belirler |

Akış: `discover` → `classifyPath` (`probeDir` + `walk` + `detectArchetype` +
`estimateReclaimable` + `decide` + `buildDeleteTargets`) → `Cluster`.

## 2. Güçlü yanlar (korunmalı)

- Türe dayalı karar, ada dayalı değil; `detectArchetype` sırası gerekçelendirilmiş.
- Savunmacı varsayılanlar: `virtual-disk`, `os-user-data`, `project-artifact` için hedef yok.
- `enforceTargetConsistency`: hedefi olmayan küme "önerilen" kalamaz.
- Hassas sınıflar (`--clear-history`, `--reset-rules`, `--nuke-models`) açık bayrakla açılır.
- Parça parça, gerçek yoldan ölçüm (CUDA, GPU varyantı, eski uzantı/uygulama sürümü).
- Karar gerekçeleri `debug` ile kaydedilir; kanıt yetersizse `warn` verilir.
- `isOwnDataPath` sınır kontrolünü (`dir + '\\'`) doğru yapıyor; aracın
  kendi veri dizini korunuyor.

## 3. Bulgular

Önem: **Y** = yanlış silme/veri kaybı riski, **O** = orta (yanlış rapor, eksik ölçüm),
**D** = düşük (temizlik, performans).

### 3.1 `analyze.ts`

| # | Önem | Bulgu | Konum |
|---|---|---|---|
| E1 | Y | `detectEditorOrphans`: `extensions.json` okunamazsa `readExtensionManifest` boş set döner; `-\d+\.\d+` yedek kuralı sürüm biçimli her klasörü "artık" sayar. Manifest bozukken aktif uzantılar `recommend` olabilir. | ~satır 701–771 |
| E2 | Y | `model-store` kontrolü (adım 2), `project-workspace` ve `agent-workspace` korumalarından önce. `models` işareti yeter. Manifesti olan bir ML projesi `model-store` olabilir. | ~satır 1025 |
| E3 | Y | `detectSubParts`: CUDA dizini bir `-gpu` varyant dizininin içindeyse ters yönde çakışma kontrolü yok. Çift sayım ve iç içe silme hedefi. `extra` + `detectSubParts` arasında da çakışma temizliği yok. | ~satır 627–681 |
| E4 | O | `estimateReclaimable`: `os-user-data` ve `unknown` varsayılan dala düşüp log/db dosya **sayısından** pozitif değer üretiyor (karar "SİLİNMEZ" iken). `temp-scratch` ve `runtime-pool` `totalBytes` dönüyor, hedef ise yaşla kısıtlı (`older`). `reclaimable` yalnızca yukarı düzeltiliyor (`Math.max`), git filtresinden sonra yeniden hesaplanmıyor. | ~satır 1201–1257, 279 |
| E5 | O | `model-store` kararında `gpuVariants` `/gpu\|cuda\|trt/` isim regex'iyle; `webgpu-ep` ayrımı burada uygulanmıyor. `ev.largeFiles` hepsine sabit `kind: 'onnx-model'` atanıyor ve `maxLarge: 12` ile kırpılıyor. | ~satır 100, 1429 |
| E6 | O | `findDirsNamed` (4000) / `findDirsContaining` (6000) üst sınıra ulaşınca sessizce duruyor, `onSkipped` ile bildirmiyor. `compareVersions` son ekleri (`-beta`) yok sayıyor. `detectAppVersionOrphans` en yüksek sürümü "güncel" sayıyor (yarım kalmış güncelleme riski). | ~satır 882–951, 781–843 |
| E7 | O | `isTempPath` ve `rootScope` `startsWith` kullanıyor, `\` sınırı yok (`...\Temp2`, `C:\Users\Omer2` yanlış eşleşir). | ~satır 976, 1146 |
| E8 | D | `walk` en az 8 yerde çağrılıyor; aynı dizin birden çok kez yürünüyor. İki ayrı BFS aynı ağacı geziyor. | genel |
| E9 | O | `buildSensitiveTargets`: `chat-history` işareti kök düzeyinde tek bir işarete dayanıyor; `history` / `chats` gibi genel adlı alt klasörler dizin başına kanıtlanmadan hedefleniyor. | ~satır 467–511 |
| E10 | D | Ölü/tekrar kod: `hasSdkMarker` hiçbir yerden çağrılmıyor; `'editor-workspace'` hiç üretilmiyor; adım 3b ve 7 aynı `agent-workspace` kontrolünü tekrarlıyor; `GPU_STATE` global `export let`; `detectGpu` yolu `C:\Windows\System32` sabit. | çeşitli |
| E11 | D | Kırılgan eşleşme: `/model katalogu\|model calistirma/` gibi regex'ler `classifier.ts`'in ürettiği Türkçe `means` metnine bağlı. Metin değişirse tür tespiti sessizce bozulur. Ayrıca `/gunlendirme gunlugu/` hiçbir `means` ile eşleşmiyor. | ~satır 1025, 1047, 1115 |
| E12 | D | 1848 satırlık tek modül; kullanıcıya dönük metinler ASCII Türkçe ile diakritikli karışık. Bölme (`archetypes`, `targets`, `subparts`, `verdicts`) ve i18n tablosu düşünülebilir. | genel |

### 3.2 `classifier.ts`

| # | Önem | Bulgu | Konum |
|---|---|---|---|
| C1 | Y | `LOG_MARKERS`: `/Notebook\|kernel\|jupyter/i` ve `/pipe\\/i` genel log satırlarında geçer. `analyze.ts` bu anlamları (`notebook calistirma`, `arka plan servisi`) `runtime-pool` için yeterli kanıt sayıyor. Sonuç: sıradan bir uygulama klasörü `runtime-pool`, hedef kökün 90 günden eski dosyaları, `reclaimable = totalBytes`. | satır 940–942; analyze ~1047 |
| C2 | Y | `ORT_DLL_RE = /^onnxruntime[_-].*\.(dll\|so\|dylib)$/` `onnxruntime_providers_shared.dll` ve `onnxruntime-genai.dll` gibi CPU'da da çalışan dosyaları `cuda-runtime` sayıyor. `analyze.ts detectSubParts` doğru olarak `cuda` içerenleri arıyor; iki dosya tutarsız. NVIDIA olmayan makinede klasör `accelerator-runtime` + tüm kök hedefi olabilir. | satır 155, 258, 471 |
| C3 | Y | `MODEL_MARKERS` içinde genel `models` adı; hem kökte hem `deepProbe` (derinlik 3) içinde işaret olarak ekleniyor. Manifestsiz bir veri klasörünün `data\models` alt klasörü `model-store` yapar. | satır 161, 189, 476 |
| C4 | Y | `chat-history` işareti dizin **adından** (`sessions`, `history`, `conversations`, `chats`) ve kökteki `chat*.json` **dosyasından** üretiliyor. `analyze.ts` bu tek işaretle dört dizini de hedefleyebiliyor. | satır 219, 264 |
| C5 | O | Log sinyali olumsuz yönde sabit: `analyze.ts` `Device: CPU` satırını görürse `GPU saglayicisi kullanildi` sinyalini yok sayıyor. Model kataloğu logları GPU kullanılırken de "Device: CPU" yazabilir. | satır 936–937; analyze ~619, 1390 |
| C6 | O | `readLogFile` 512 KB'tan büyük dosyayı tamamen atlıyor, küçüklerde ilk 400 satırı okuyor; yani güncel durum yerine en eski satırlar kanıt oluyor. | satır 964–984 |
| C7 | O | `probeLogs`: `catch` içindeki ikinci `readdir` try dışında (istisna `probeDir`'i düşürür); yedek dalda yol `logs\` önekiyle yanlış kuruluyor. `LOG_DIR_RE` `daemon.log` gibi dosya adlarını da `logs` dizini sanıyor. | satır 948–962, 386 |
| C8 | D | Ölü kanıt yolları: `fileKinds.push('python-env')` dizin dalındaki `n === 'pyvenv.cfg'` altında (dosya olduğu için hiç çalışmaz); `'venv'` fileKind'i hiç üretilmiyor; `PYENV_MARKERS` içindeki `'Scripts'` büyük harfli, dizinde küçük harfle karşılaştırılıyor. `analyze.ts` içindeki `kinds.has('python-env'/'venv')` koşulları fiilen ölü. | satır 159, 191–192 |
| C9 | O | `sdkInstall`: `sdk`, `shared`, `tools`, `host` adlı **tek** dizin yeter. `analyze.ts` içindeki kullanılmayan `hasSdkMarker` ("sdk + shared birlikte") daha sıkı eski kuralı yansıtıyor. Zararsız tarafa hata yapar ama `tools`/`shared` olan sıradan klasörlerin önbelleği raporlanmaz. | satır 212; analyze 1161 |
| C10 | D | `deepProbe`: `entries.filter(isDirectory).slice(0, 40)` dosya sistemi sırasına bağlı (belirsiz). `p.fileKinds.length >= 4` erken çıkışı dedupe edilmemiş listeye bakıyor. | satır 465, 512 |
| C11 | D | Başlık "hiçbir uygulama adı içermez" diyor; yorumlarda `.MuhasibPro`, `opencode`, `claude` geçiyor. `LOG_MARKERS` içinde `Azure AI Foundry` gibi ürün özel kalıplar var. | satır 11–14, 364, 935 |

### 3.3 `walker.ts`

| # | Önem | Bulgu |
|---|---|---|
| W1 | O | `largeFiles`: liste `maxLarge`'a ulaşınca daha büyük dosya atılıyor; "en büyük N" yerine "ilk bulunan N" tutuluyor. Yorum "küçükten büyüğe" diyor, sıralama büyükten küçüğe. `analyze.ts` bu listeyi karar için kullanıyor. |
| W2 | O (doğrulanmalı) | `stat()` `{ bigint: true }` olmadan çağrılıyor; `BigInt(st.ino)` zaten yuvarlanmış sayıyı çeviriyor. NTFS dosya kimliği 64 bit; 2^53 üstü değerler hassasiyet kaybeder, farklı dizinler aynı anahtarı üretip `link-loop` olarak atlanabilir. Bunun gerçek makinede tetiklenip tetiklenmediği doğrulanmadı. |
| W3 | O | `onProgress` koşulu (`res.dirs % 256 === 0`) dosya döngüsünün **içinde**: `dirs` 0 veya 256'nın katıyken her dosyada çağrılıyor, aksi halde dosya ağırlıklı klasörlerde hiç çağrılmıyor. |
| W4 | O | Bayt sayımı mantıksal boyut (`st.size`); hardlink'ler tekrar sayılıyor (pnpm deposu hardlink içerir, gerçek geri kazanım düşük olur); OneDrive yer tutucu dosyalar boyut raporlar ama diskte yer tutmaz. |
| W5 | O | `classify()` ENOENT dışındaki hataların (EBUSY, EMFILE, EIO...) hepsini `gone` yapıyor; ölçüm eksik kalsa da "ortadan kalkmış" görünüyor. |
| W6 | D | Her girdi için sıralı `await stat`; klasör içinde paralellik yok (`walkMany` yalnızca kökler arası). Antivirüs gecikmesinde yavaş. |
| W7 | D | `isFile/isDirectory/isSymbolicLink` hepsi `false` ise girdi sessizce yok sayılıyor; `followLinks` dalında kullanılmayan `readlink`; kullanılmayan `dirname` importu ve `export { dirname }`; `\\` ayracı sabit. |

### 3.4 `discover.ts`

| # | Önem | Bulgu |
|---|---|---|
| D1 | O | Yerel AppData bloğu `want('temp')` koşulunu içeriyor; yorum "yalnızca %TEMP%, tüm AppData taranmaz" diyor. `--env temp` ve `lean` aslında tüm LocalAppData'yı tarıyor. |
| D2 | O | `lean` profili: `envs: ['pkgcache', 'temp']` ve `exclude: ['Temp']` çelişiyor; `%TEMP%` yolunun son parçası dışlandığı için hiç eklenmiyor. |
| D3 | O (doğrulanmalı) | `PROTECTED_ROOTS` içinde `packages` ve `wsl` var; WSL dağıtım diskleri bu konumlarda tutuluyor olabilir. `vdisk` env'i (sadece raporlama) en büyük hedefleri göremez. Koruma silme kapısında olmalı, keşif kapısında değil. |
| D4 | O | `pkgcache`, `agent`, `runtime` seçimlerinin hepsi aynı kümeyi (tüm nokta klasörleri + tüm AppData çocukları) tarıyor; `lean` açıklaması ("sadece güvenli önbellekler") discover tarafından garanti edilmiyor. |
| D5 | O | `audit` ("hiçbir şey silme") için `Profile` içinde `readOnly` alanı yok; vaat kodda taşınmıyor. |
| D6 | Y | `isOwnDataPath` normalize etmiyor: `resolve`, `realpath`, `/` ↔ `\`, `\\?\` ön eki, 8.3 kısa adlar, junction eşleşmez. Kasa dizini "artık" olarak taranabilir. |
| D7 | Y | Ters yön koruması yok: tarama kökü kasayı **içeriyorsa** (örn. `%USERPROFILE%` taranıyor) kasa yolları silme hedeflerinden ayıklanmıyor. |
| D8 | Y | `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube` gibi kimlik bilgisi klasörleri aday listesinde; `PROTECTED_ROOTS` yalnızca AppData'ya uygulanıyor. |
| D9 | O | `listDirs` her hatada `[]` döner (boş/erişilemeyen kök sessizce "0 klasör"); `stats.denied` hiç artırılmıyor; junction/symlink olan kökler `isDirectory()` `false` olduğu için sessizce atlanıyor. |
| D10 | D | Roaming döngüsünde `isOwnDataPath` çağrısı yok (şu an etkisiz, tutarsız). |
| D11 | D | `addExtra` yorumu yalnızca `%TEMP%` eklendiğini söylemiyor; `sortTargets` girdiyi aynen döndürüyor; `ownerlessName` `analyze.ts baseName` ile aynı; `exists` kullanılmıyor; `export { ownerlessName }` tanımdan önce. |
| D12 | D | `DATA_DIR_NAME` / `LEGACY_DATA_DIR_NAME` kullanılıyor; `residue-cleaner` adı hiçbir sürümde veri dizini olarak kullanıldıysa `ownDataDirs`'e eklenmeli. `data-dir.ts` görülmedi. |

## 4. Önerilen uygulama sırası

1. **Prompt 1** (yanlış silme riski): E1, E2, E3, E9, C1–C5.
2. **Prompt 3** (keşif ve koruma): D6, D7, D8, D1–D5, D9.
3. **Prompt 2** (ölçüm doğruluğu): W1–W6, E4, E8.
4. **Prompt 4** (sağlamlık ve temizlik): C7–C10, E6, E7, E10, E11.

Her prompttan sonra testleri çalıştır, commit at, ardından sıradakine geç.

---

## 5. Promptlar

### Prompt 1: Yanlış silme riski (en öncelikli)

```
Proje: residue-cleaner (TypeScript, Windows). Dosyalar: analyze.ts, classifier.ts.
Kural: Uygulama adı sabit kodlama; proje içi taramalar report-only kalır (AGENTS kural 9).
Önce her maddeyi kodda doğrula, sonra düzelt, her biri için birim testi ekle:

1. classifier.ts LOG_MARKERS: /Notebook|kernel|jupyter/i ve /pipe\\/i tek başına
   "runtime-pool" kanıtı olmamalı. analyze.ts detectArchetype 4. adımı, log anlamı
   dışında yapısal bir işaret (envs, conda-meta, pyvenv.cfg, site-packages) da
   istesin. Aksi halde herhangi bir uygulama klasörü runtime-pool olup 90 günden
   eski dosyaları hedefleniyor.
2. classifier.ts ORT_DLL_RE: yalnızca CUDA/TensorRT sağlayıcılarını cuda-runtime
   saymalı (onnxruntime[_-].*cuda.*). onnxruntime_providers_shared.dll ve
   onnxruntime-genai.dll CPU'da da çalışır; analyze.ts detectSubParts ile aynı kural.
3. analyze.ts: log'da "GPU saglayicisi kullanildi" anlamı varsa "cpuOnly" sayma
   (olumlu sinyal olumsuzu veto eder). classifier.ts readLogFile: 512KB üzeri
   dosyayı atlama; dosyanın SON ~64KB'ını oku, son satırlara öncelik ver.
4. analyze.ts detectArchetype: 'model-store' kontrolünü 'project-workspace' ve
   'agent-workspace' korumalarından SONRA al ya da !probe.projectManifest şartı koy.
   classifier.ts: 'models' dizin adı tek başına model-store kanıtı olmasın
   (içinde model.onnx / tokenizer.json / genai_config.json gibi dosya gerekli).
5. analyze.ts detectEditorOrphans: extensions.json okunamazsa (boş set) yalnızca
   .obsolete listesine güven; -\d+\.\d+ yedek kuralını yalnızca manifest başarıyla
   okunduysa uygula. Manifest bozukken hiçbir uzantı 'recommend' olmamalı.
6. analyze.ts: detectSubParts çıktı listesinde bir parça başka bir parçanın içinde
   kalıyorsa (CUDA dizini bir -gpu varyant dizininin içinde, ya da tersi) iç
   olanı ele; baytlar iki kez sayılmasın, silme hedefleri iç içe olmasın.
   extra + detectSubParts birleşiminde de aynı temizliği yap.
7. classifier.ts: chat-history işareti dizin bazında üretilsin; sessions/history/
   conversations/chats dizininin İÇİNDE oturum JSON/JSONL kanıtı yoksa
   buildSensitiveTargets o dizini hedeflemesin.
```

### Prompt 2: Ölçüm doğruluğu (walker.ts + estimateReclaimable)

```
Proje: residue-cleaner. Dosyalar: walker.ts, analyze.ts (estimateReclaimable, classifyPath).
Önce her maddeyi doğrula, sonra düzelt, test ekle:

1. walker.ts largeFiles: liste doluyken daha büyük dosya geldiğinde en küçüğü çıkarıp
   yeniyi ekle (gerçek "en büyük N"). Yorumdaki "küçükten büyüğe" yanlış; büyükten
   küçüğe sıralı tut. Insert başına sort yerine uygun bir yapı kullan.
2. walker.ts: stat(..., { bigint: true }) kullan; ino/dev BigInt doğrudan gelsin
   (NTFS 64-bit file id Number'da yuvarlanır, link-loop yanlış pozitifine yol açabilir).
3. walker.ts: dosya (dev, ino) için nlink > 1 ise aynı dosyayı bir kez say
   (pnpm deposu hardlink). Mümkünse tahsis edilen boyutu da raporla; en azından
   WalkResult'a hardlinkedBytes ekle.
4. walker.ts onProgress: dosya başına değil, zaman (~100ms) veya bayt eşiğiyle
   throttle et.
5. walker.ts classify(): ENOENT -> 'gone', EACCES/EPERM -> 'denied', uzun yol ->
   'long-path', geri kalan (EBUSY, EMFILE, EIO vb.) -> 'error' + code alanı.
   SkippedEntry tipini güncelle.
6. walker.ts: klasör içinde sınırlı paralel stat (örneğin 32'lik gruplar).
7. analyze.ts estimateReclaimable: os-user-data ve unknown için default dalını
   kaldır; os-user-data -> 0. temp-scratch ve runtime-pool için 'older' hedefe
   uyan baytı (yaşla kısıtlanmış) hesapla. classifyPath sonunda reclaimableBytes
   = silme hedeflerinin toplam baytı olsun (git filtresi sonrası); Math.max
   yerine doğrudan atama.
8. analyze.ts classifyPath: walk() sonuçlarını yola göre önbellekle
   (Map<path, Promise<WalkResult>>), aynı dizini birden fazla kez yürüme.
```

### Prompt 3: Keşif ve koruma (discover.ts)

```
Proje: residue-cleaner. Dosya: discover.ts (+ gerekirse analyze.ts classifyPath).
Önce her maddeyi doğrula, sonra düzelt, test ekle:

1. temp env'i yalnızca %TEMP% eklesin; LocalAppData'nın tamamını taramasın
   (koşuldan want('temp') çıkar). vdisk için ayrı, yalnızca sanal disk içeren
   konumları kapsayan dar bir keşif yaz.
2. lean profili: exclude: ['Temp'] ile temp env'i çelişiyor; Temp'in taranmasını
   istiyorsan exclude'u kaldır, istemiyorsan 'temp' env'ini kaldır. Kararı
   yorumla belgele.
3. PROTECTED_ROOTS'u keşif değil SİLME kapısına taşı: packages, wsl gibi
   korunanlar vdisk için keşfedilsin, her zaman report-only olsun.
4. isOwnDataPath: önce path.resolve + win32.normalize, eğik çizgileri \ yap,
   \\?\ önekini temizle, mümkünse fs.realpath ile çöz; sonra küçük harfle sınır
   kontrolü yap. Testler: 'C:/Users/x/AppData/Local/residue/sub', '..' ile
   dolaşan yol, trailing slash, büyük/küçük harf, \\?\ öneki.
5. Ters yön: bir tarama kökü kasa dizinini içeriyorsa (ancestor), silme hedefleri
   hesaplanırken kasa yolları çıkarılsın.
6. Kimlik bilgisi klasörleri (.ssh, .gnupg, .aws, .azure, .kube) için PROTECTED_DOT
   kümesi: aday olmasın veya her zaman report-only.
7. Roaming döngüsüne de isOwnDataPath ekle.
8. listDirs hata döndürsün; LOCALAPPDATA/APPDATA/USERPROFILE boşsa veya okunamazsa
   DiscoveryResult'a uyarı ekle; stats.denied gerçekten artsın. Junction/symlink
   olan kök dizinleri sessizce atlama; 'link' nedeniyle skipped olarak raporla.
9. Profile arayüzüne readOnly?: boolean ekle ve 'audit' için true yap; silme
   katmanı bunu zorunlu kılsın.
10. Temizlik: sortTargets gerçekten sıralasın ya da kaldırılsın; kullanılmayan
    exists ve eski addExtra yorumunu düzelt; ownerlessName yerine ortak baseName.
11. data-dir.ts'te DATA_DIR_NAME'in 'residue-cleaner' ile uyumunu doğrula; gerekirse
    ownDataDirs'e ekle (LEGACY korunsun).
```

### Prompt 4: Sağlamlık ve temizlik

```
Proje: residue-cleaner. Dosyalar: classifier.ts, analyze.ts.
Önce her maddeyi doğrula, sonra düzelt, test ekle:

1. classifier.ts probeLogs: catch içindeki ikinci readdir'i try/catch ile sar;
   yedek dalda yol kurarken logs\ önekini ekleme (kök loglar zaten ayrı okunuyor).
   LOG_DIR_RE dosya adlarını (daemon.log) logs dizini sanmasın.
2. classifier.ts ölü kanıt yolları: pyvenv.cfg bir DOSYA; fileKinds'a 'python-env'
   dosya dalında ekle. 'venv' fileKind'ı hiç üretilmiyor; ya üret ya da analyze.ts
   içindeki kinds.has('venv') kullanımlarını kaldır. PYENV_MARKERS'taki 'Scripts'
   büyük harf ve dizinde küçük harfle karşılaştırıldığı için eşleşmiyor; düzelt.
3. classifier.ts sdkInstall: sdk, shared, tools, host adlı TEK dizin yetmesin
   ("sdk" + "shared" birlikte, ya da dotnet gibi yapısal kanıt). analyze.ts'teki
   kullanılmayan hasSdkMarker'ı sil veya o mantıkla birleştir.
4. analyze.ts: isTempPath ve rootScope startsWith yerine '\\' sınırlı karşılaştırma
   kullansın (C:\Users\Omer2 / ...\Temp2 yanlış eşleşmesi).
5. classifier.ts deepProbe: dizin sırasını deterministik yap (ad sırası),
   p.fileKinds.length >= 4 erken çıkışını dedupe edilmiş küme üzerinden değerlendir.
6. analyze.ts: 'editor-workspace' hiç üretilmiyor; ya üret ya da tip ve tablolardan
   çıkar. Tekrar eden 3b/7. agent-workspace kontrolünü birleştir. ClassifyOptions'a
   gpu alanı ekleyip GPU_STATE global değişkeninden kurtul (varsayılan: bilinmiyor
   = GPU var). detectGpu'da C:\Windows yerine %SystemRoot% kullan.
7. LOG_MARKERS "means" metinlerini sabit kodlara (enum) çevir; analyze.ts
   regex'leri yerine koda bak.
8. analyze.ts findDirsNamed / findDirsContaining üst sınıra ulaşırsa onSkipped ile
   bildir. compareVersions ön-sürüm eklerini (-beta) hesaba katsın;
   detectAppVersionOrphans en yüksek sürümün gerçekten bir Electron çalışma
   zamanı içerdiğini doğrulasın.
```

## 6. Açık sorular (doğrulama gerektiren varsayımlar)

- **W2**: NTFS `ino` hassasiyet kaybı gerçekten `link-loop` yanlış pozitifi üretiyor mu? Büyük, çok churn olan bir dizin (Temp, cache) üzerinde `bigint: true` ile ve onsuz sonuçları karşılaştırın.
- **D3**: WSL dağıtım diskleri bu makinede hangi yollarda? `vdisk` env'i bunları bulabiliyor mu?
- **C5**: Gerçek model/log çıktısında GPU kullanılırken de `Device: CPU` satırı geçiyor mu?
- `types.ts`, `longpath.ts`, `git.ts` (özellikle `isGitTracked` senkron mu, süreç mi başlatıyor), `data-dir.ts` ve `evidence-tree.ts` incelenmedi.
