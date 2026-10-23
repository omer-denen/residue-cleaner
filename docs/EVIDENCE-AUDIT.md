# Kanıt Hijyeni Denetimi — 22.10.2026

> Tetikleyen olay: Araçlar ekranında hiç kullanılmayan araçların "Yakında"
> görünmesi; buna karşılık `dsh` gibi gerçekten kullanılan bir aracın "Atıl"
> görünmesi. Amaç yalnızca bu hatayı değil, **aynı kanıt sınıfını** tüm
> arama/analiz hatlarında denetlemek.

## 1. Özet

Residue iki ayrı kanıt dünyası kullanıyor:

1. **Disk / küme taraması** — yapı, dosya türü, manifest, lockfile, log
   satırı, Git izi. Karar bunlardan çıkar; `atime` kullanılmaz.
2. **CLI envanteri** — kurulum, shim, durum klasörü, kabuk geçmişi ve
   `atime`. Kullanım durumu ("Atıl / Yakında / Bilinmiyor") buradan gelir.

**Sonuç:** CLI envanterinin kullanım kanıtı zayıf ve kirletilebilir. Disk
sınıflandırması bu hatadan doğrudan etkilenmiyor; ancak aynı "zaman damgası =
kanıt" varsayımı başka yerlerde de denetlenmeli. `alpha` etiketi bu nedenle
doğru: kapsam ve kanıt kalitesi hâlâ olgunlaşıyor.

## 2. Gerçek veride bulunan hatalar

| Araç | Gösterilen | Kanıt | Gerçek |
|---|---|---|---|
| crewai | Yakında | shim atime 18.10 08:43:46; geçmiş yok | Toplu atime; kullanım değil |
| vpk | Yakında | shim atime 18.10 08:43:48; geçmiş yok | Toplu atime; kullanım değil |
| dotnet-script | Yakında | shim atime 18.10 08:43:48; geçmiş yok | Toplu atime; kullanım değil |
| opencode2 | Yakında | atime = kurulum anı 22.10 16:17:47; geçmiş yok | Kurulum artefaktı; kullanım değil |
| windows-mcp | Yakında | `~/.windows-mcp` içindeki log 22.10 21:43; süreç çalışıyor | Log mtime'ı durum sanılıyor |
| dsh | Atıl | `npx @deepseek-ai/dsh web`, `pnpm dsh web` | Gerçek kullanım kaçırılıyor |
| claude | Yakında | Geçmişte 2 kez (satır 26/29), atime 22.10 | Geçmiş "en az bir kez" der; **zaman vermez** |
| dotnet-ef | Yakında | atime 19.10; Prefetch 19.10 20:26 | Gerçekten çalışmış olabilir |
| muse | Yakında | Geçmişte 1 kez (satır 93), atime 22.10 | Geçmiş var; zaman belirsiz |
| browser | Atıl | Geçmiş yok; shim 20.08 | Makul |

**Kritik kanıt:** `crewai`, `vpk`, `dotnet-script` shim atime'ları **1.7 saniye
içinde** güncellenmiş. Üç farklı paket yöneticisine ait araçların aynı anda
çalıştırılması pratikte imkânsız; bu bir toplu okuma (Defender / yedekleme /
indeksleyici) etkisidir.

## 3. Aynı hata sınıfı — kod denetimi

| # | Yer | Sorun | Etki | Öneri |
|---|---|---|---|---|
| E1 | `scanStandaloneShims` | Sürüm için `readExeInfo(p)` çağrısı shim'in atime'ını günceller; atime önce alınıyor ama **geri yazılmıyor** | Sonraki tarama "az önce kullanıldı" sanır (claude/muse/windows-mcp) | Okuma öncesi atime/mtime sakla; `utimes` ile geri yaz |
| E2 | `annotateHealth` | Küçük stub `.exe` dosyalarını `readExeInfo` ile okur, atime'ı geri yazmaz | Bozuk araçların atime'ı kirlenir | Aynı koruma |
| E3 | `findStateDirs` / `boundedStats` | Durum klasörünün **tüm** dosyalarını (loglar dahil) tarar; en yüksek mtime logdan gelebilir | Çalışan servis "kullanıldı" görünür (windows-mcp) | `logs/`, `*.log`, `*.jsonl`, `*.tmp` dosyalarını hariç tut; yalnızca config/state/db |
| E4 | `findStateDirs` | `%LOCALAPPDATA%\Programs\<ad>` kurulum dizinini "durum" adayı sayar | Kurulum/güncelleme mtime'ı kullanım sanılır | Kurulum dizinini durum adaylarından çıkar |
| E5 | `usageVerdict` | Atime tek başına `recent` için yeterli | Toplu atime / kurulum anı "Yakında" olur | Atime tek başına `recent` üretmesin; en az bir doğrulayıcı sinyal (geçmiş/gerçek durum/süreç) ara |
| E6 | `usageVerdict` | `installedAt` ile `lastAccessAt` aynıysa bunu ayırmıyor | Yeni kurulan araç "Yakında" | Kurulum anına ≤2 sn mesafedeki atime'ı yok say |
| E7 | `findHistoryMentions` | Yalnızca komutu satır başında / `;|&` sonrasında arar | `npx @scope/pkg`, `pnpm dsh`, `dotnet tool run` kaçar | Paket çalıştırıcı farkındalığı; `install/add` hariç |
| E8 | `usageVerdict` | `historyRecent` satır sırasına bakar; satır sırası **zaman değildir** | Aylar önceki kullanım "Yakında" olabilir | Geçmiş tek başına `recent` üretmesin; "kullanıldı, zaman bilinmiyor" |
| E9 | Tüm şema | Toplu atime güncellemesini ayırt eden filtre yok | Aynı saniyede 3+ araç "kullanıldı" | 5 sn içinde ≥3 farklı komut aynı atime ise atime'ı kanıttan çıkar |
| E10 | Prefetch | Windows'un gerçek çalıştırma zamanı kaynağı kullanılmıyor | Geçmiş zamanı belirsiz kalıyor | İsteğe bağlı, salt okunur Prefetch kanıtı (exe adı + son yazma) |

## 4. Disk / AI / node_modules tarafı

Aynı sınıfın disk tarafındaki durumu:

| Alan | Kullanılan kanıt | Atime riski | Durum |
|---|---|---|---|
| `walker.ts` | `mtime` (lastTouched), boyut, dosya sayısı | Yok; mtime arka plan yazımıyla değişebilir ama **muhafazakâr** yönde | Sağlam |
| `node_modules` / proje | `package.json`, lockfile, `node_modules`, `patches`, `file:`/`link:` | Yok | Rapor modu; silme hedefi yok |
| model store | `model.onnx`, `model.gguf`, `model.safetensors`, `tokenizer.json`, `pytorch_model.bin` | Yok | **T30 ile tamamlandı:** kök ağırlık + manifest kombinasyonu `model-store`; rapor-only |
| log sinyalleri | Log satırı metni | Yok | Kanıt metni; `break` kaldırıldı (K7) |
| vektör DB | `.faiss/.lance/.npy` + UUID klasörler | Yok | Yapısal |
| ajan alanı | `SKILL.md`, `.skill-lock.json` | Yok | Kullanıcı değeri; silme yok |
| CLI kullanımı | atime + durum + geçmiş | **Yüksek** | Bu raporun konusu |
| Node sürümleri | exe VersionInfo; `readExeInfo` | atime kullanılmıyor | Karar etkilenmez |

**Cevap:** `node_modules` ve AI kalıntıları, CLI "kullanım" rozetinden bağımsız
olarak **yapısal kanıtla** sınıflandırılıyor. Ancak `model-store` kapsamı eksik
(T30) ve CLI kullanım kanıtı güvenilir değil. Bu yüzden "alpha" doğru.

## 5. `claude` özel sorusu

- Kabuk geçmişinde `claude` iki kez var: **satır 26 ve 29 / 167**.
- Bu, "en az iki kez çalıştırıldı" demektir; **ne zaman** çalıştırıldığını
  söylemez. PSReadLine geçmişi zaman damgası tutmaz.
- Satırlar dosyanın başında; sonra 130+ komut var. Yani kullanım **eski**.
- `claude.exe` atime'ı 22.10; ancak bu, envanterin kendi `readExeInfo` okuması
  ve/veya toplu okuma ile kirlenmiş olabilir (E1/E9).
- Prefetch'te `CLAUDE` kaydı yok; `DOTNET-EF` ve `OPENCODE` kayıtları var.
- **Sonuç:** Son gerçek çalıştırma zamanı **bilinmiyor**; "Yakında" demek için
  yeterli kanıt yok. Doğru etiket: "Kullanıldı (tarih bilinmiyor)" veya
  "Bilinmiyor".

## 6. Düzeltme sırası

> **Durum 23.10.2026:** F1 ✅ `8d9610a` · F2 ✅ `a783f3e` · F3 ✅ `277bf73`
> · F4 ✅ `ec9478d` · **F5 ⏸ web onayı bekliyor** (T74; kullanıcı onayı
> olmadan web arayüzüne geçilmez).

1. **F1 — Observer hijyeni:** `scanStandaloneShims` + `annotateHealth` okumalarında
   atime/mtime'ı geri yaz; ortak `withPreservedAtime` yardımcısı.
2. **F2 — Durum kanıtı:** `boundedStats` log/cache/tmp hariç; `Programs/<ad>`
   adayını çıkar.
3. **F3 — Karar:** atime tek başına `recent` üretmesin; kurulum-atime ayrımı;
   toplu atime filtresi; geçmiş tek başına `recent` üretmesin.
4. **F4 — Geçmiş:** paket çalıştırıcı farkındalığı + pozitif/negatif testler.
5. **F5 — Kanıt görünürlüğü:** UI'da "kanıt türü" ve "güven" ayrımı; "Yakında"
   yerine kaynağı belirsizse "Bilinmiyor".
6. **F6 (opsiyonel):** Prefetch tabanlı gerçek çalıştırma zamanı.

## 7. Test matrisi

- Atime burst: 3 farklı shim, aynı 5 sn → atime yok sayılır.
- Kurulum-atime: atime ≈ mtime → kullanım değil.
- Log-only durum klasörü: `logs/*.log` güncel, config eski → "Yakında" değil.
- `pnpm dsh web`, `npx @scope/pkg`, `dotnet tool run x` → kullanım.
- `npm install -g x`, `pnpm add x`, `yarn add x` → kullanım değil.
- `readExeInfo` sonrası atime değişmiyor.
- Gerçek veri: crewai/vpk/dotnet-script → Atıl/Bilinmiyor; dsh → Bilinmiyor/
  Yakında (geçmiş var); opencode2 → Bilinmiyor; windows-mcp → çalışıyor.

## 8. Dersler

- **K16:** Envanter kendi atime kanıtını kirletiyor (observer etkisi).
- **K17:** Toplu atime güncellemesi "kullanıldı" değildir.
- **K18:** Durum klasörü mtime'ı log dosyasından geliyorsa kullanım kanıtı değildir.
- **K19:** Kabuk geçmişi paket çalıştırıcılarını görmez; satır sırası zaman değildir.
- **Kural 21:** Zaman damgası kanıtı tek başına karar üretmez; observer etkisi,
  toplu güncelleme ve arka plan yazımı elenmeden "kullanıldı" denmez.
