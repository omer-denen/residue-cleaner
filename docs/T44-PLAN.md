# T44 — Arayüz ürün planı (iki profilli konsol)

> **Durum: PLAN + M0-M5 tamam (21.10.2026, 2.2.0).** Bu belge
> `docs/WEB-REBUILD-PLAN.md`'nin yerini alır; oradaki mimari kurallar
> (motor/arayüz ayrımı) geçerlidir.
>
> **Değişmez kural:** Tarayıcı **yalnızca istek gönderir**. Hangi kümenin
> listeleneceği, neyin seçilebilir olduğu, onay ifadesi, toplamlar, kartlar
> ve sıralama **Karar Motoru**'ndan (`src/core/*`) gelir. Arayüz kendi
> kararını üretmez; yalnızca kimlikleri metne çevirir ve biçimlendirir.

---

## 1. İki kullanıcı profili

| | **A — Emeğini koruyan proje sahibi** | **B — Sürekli deneyen vibe coder** |
|---|---|---|
| Kaygı | Yanlış silme emeği götürür | Makine şişer, PATH bozulur |
| Nesne | Proje | Araç / kurulum kanalı |
| Sıklık | Ayda bir derin temizlik | Haftada bir / günlük |
| Kanıt | lockfile, git tracked, son kullanım | atime, shim, kanal, PATH gölgesi |
| Varsayılan eylem | Tarif göster / planla | Kaldırma planı / onar / karantina |
| Başarı anı | "12 projede 3.2 GB; hepsi geri gelir; 0 tracked hedef" | "6 atıl aracı kanalıyla kaldırdım; 4 gölge gitti" |
| Başarısızlık | Tek yanlış silme | Uzun onay zinciri → vazgeçer |

**Çözüm:** İki defter, tek güvenlik çekirdeği.

- **Projeler defteri** — korunan emek; `report-only` + tarif + kasa.
- **Araçlar defteri** — kurulu deneyler; kaldırma planı + onarım + karantina.
- **Ortak** — Disk, Plan/Onay, Kasa, Ayarlar.

Proje artefaktı ile kurulu araç **aynı listede karışmaz**. Karışırsa iki
profil de yanlış karar verir.

---

## 2. Arayüz sözleşmesi (request-only)

```
web/ (React)  --istek-->  src/web/server.ts  -->  src/services/*  -->  src/core/* (KARAR)
   ^                                                                        |
   +------------------------ gorunum (view) -------------------------------+
```

Kurallar:

1. Tarayıcı **hesap yapmaz**: toplam, yüzde, sayı, kart, "güvenli kazanım"
   ve onay ifadesi motordan gelir.
2. Tarayıcı **yol göndermez** (silme/plan). Tek istisna: salt-okunur proje
   keşfi kökleri (`/api/projects/discover`); sunucu doğrular, hiçbir hedef
   üretmez.
3. Tarayıcı **metin seçmez**: kart/etiket kimlikleri (`id`) motordan gelir;
   TR/EN çevirisi arayüzde yapılır.
4. Yeni bir davranış gerekirse önce `src/core/` + test, sonra endpoint,
   en son arayüz.
5. Token: `GET /` sırasında `HttpOnly + SameSite=Strict` çerez; API çağrısı
   aynı origin. URL'de token yok.
6. `dist/web` pakete girer; `residue ui --web` statik kabuğu sunar.

### Ekranlar

| # | Ekran | Profil | Karar kaynağı |
|---|---|---|---|
| 1 | Genel Bakış | ikisi | `GET /api/dashboard` (yeni motor) |
| 2 | Disk | ikisi | `scan*`, `latest`, `plan`, `execute` |
| 3 | Projeler | A | `GET /api/projects/discover` (yeni motor) |
| 4 | Proje detay | A | `projects`, `projects/plan`, `projects/restore` |
| 5 | Araçlar | B | `cli/inventory*`, `graph`, `cli/plan` |
| 6 | PATH & Ortam | B | `env*` |
| 7 | Graf | B | `graph*` |
| 8 | Planlar & Zamanlama | ikisi | `schedules*` |
| 9 | Plan & Onay | ikisi | `plan`, `execute`, `jobs` |
| 10 | Kasa | ikisi | `vault*` |
| 11 | Ayarlar | ikisi | `settings`, `update` |

---

## 3. Motor boşlukları (arayüzden ÖNCE)

| Modül | Görev | Neden motorda |
|---|---|---|
| `core/dashboard-summary.ts` | Korunan/geri kazanılabilir toplamlar, risk kartları, güvenli kazanımlar | Arayüz hesap yapamaz; iki ekran aynı sayıyı göstermeli |
| `core/project-discovery.ts` | Kökler altında repo keşfi (salt okunur) | "Projelerim" listesi tarayıcıda uydurulamaz |
| `DashboardService` | Taranmış önbellek + env + graf + kasa + planları tek görünüme toplar | Ağır taramayı tetiklemez; yalnız önbellek |

Her ikisi de `tests/` ile doğrulanır. `GET /api/dashboard` ve
`GET /api/projects/discover` sözleşmeye eklenir.

---

## 4. Kilometre taşları

| Dilim | İş | Kabul |
|---|---|---|
| **M0** | Kabuk: Vite+React, `dist/web`, `residue ui --web`, çerez token, API istemcisi, TR/EN, 3 sütun, Genel Bakış | `ui --web` açar; URL'de token yok; ekran yalnız `/api/dashboard` verisini gösterir |
| **M1** | Disk → Plan → Onay → Kasa | 100+ kümede akıcı; SSE yeniden bağlanır; kasaya taşımada `TASI`, kalıcı silmede `SIL`; kasa geri yükleme |
| **M2** | Projeler | Repo keşfi; source asla hedef değil; tarif + hash |
| **M3** | Araçlar + PATH/Env + Graf | Kanal bazlı envanter; graf engeli gerekçeli; env planı yedek gösterir |
| **M4** | Planlar/Zamanlama + Ayarlar + Güncelleme | Kural oluşturma `PLANLA`; yalnız kasaya taşır |
| **M5** | Cila + yayın | Klavye-only tur; a11y; headless smoke; `npx` ile arayüz |

Sürüm: **2.2.0** (yeni özellik = minor). M3–M4 sarkarsa 2.2.0 M0–M2 ile
çıkar, kalanı 2.3.0 olur.

**M2 tamam (21.10.2026, SALT OKUNUR):** `core/project-view.ts`
(`ProjectList` + `ProjectAnalysis`), `GET /api/projects/roots`,
`/api/projects/discover` filtre/sıralama/sayım + 60 sn önbellek,
`/api/projects?path=` artifact + lockfile hash + kurulum/doğrulama tarifi.
Projeler ekranı: kök düzenleyici, motor özeti, sekmeler (Tümü / bağımlılıklı /
Git / ajan alanı), arama, sıralama, proje raporu ve plan engelleri.
Silme, plan yürütme ve tarif çalıştırma arayüzde **yok**; `projects/plan` ve
`projects/restore` uçları (`KUR` onayı) sonraki dilimdedir.

**M3 tamam (21.10.2026):** `core/cli-view.ts` (`CliView` filtre/sıralama/
kaynak sayımı/seçilebilir kimlik), `GET /api/cli/view`, CLI kaldırma planı
`SIL` + `approvalKind: delete`; `env-engine` onayı `ApprovalRules`
(`envClean` = `TEMIZLE`), `POST /api/env/plan` ifadeyi döndürür; grafik
`GraphViewResponse` + `GraphWhatIfResponse` sözleşmeye taşındı.
Ekranlar: **Araçlar** (SSE envanter, durum/kanal, detay, kaldırma planı),
**PATH & Ortam** (bulgular, plan öncesi/sonrası, yedek notu ve sonucu,
yazılı `TEMIZLE`), **Graf** (düğüm/kenar, kök neden, what-if engeli).
Graf/Env ekranlarında yazma yalnız plandan sonra ve yazılı onayla yapılır.

**M4 tamam (21.10.2026):** `ScheduleView` / `ScheduleCreateRequest` ve
list/catchup/history sözleşmeleri; `POST /api/schedules` yazılı **`PLANLA`**
ister (`ApprovalRules.schedule`), CLI `schedule add --phrase PLANLA` aynı
kuralı kullanır. **Planlar** ekranı: seçici, frekans, kategori, risk/limit,
önizleme, iki adımlı çalıştırma/silme, kaçırılan çalışma önerileri, geçmiş.
**Ayarlar** ekranı: tarama önbelleği, kasa saklama, güncelleme modu
(`off/daily/weekly`), kaydetme ve `force` kontrolü; kapalıyken ağ isteği
yapılmaz. Planlı işlem yalnız kasaya taşır.

**M5 tamam (21.10.2026, 2.2.0):** klavye-only tur — "İçeriğe geç" /
"Listeye geç" bağlantıları, rail'de ok tuşları + roving tabindex, `/` ile
aramaya odak, `?` kısayol penceresi (odak tuzağı, `Esc`, odağı geri verme),
satır eylemleri gerçek düğme (Tab + Enter). a11y: görünür odak halkaları,
canlı seçim duyurusu, `role="alert"` hata banner'ları, `aria-busy`,
`progressbar`, kontrast artışı, `prefers-reduced-motion`. Headless smoke
(`npm run smoke`, çerez/401/403/onay kapıları) ve paket smoke
(`npm run smoke:package`: `npm pack` → boş klasöre kur → arayüz).
Gerçek Edge turu: `scratch/ego-m5-01..09*.png`. Tag/publish kullanıcı onayına
bağlıdır.

---

## 5. Açık işler

| ID | İş | Durum |
|---|---|---|
| B12 | `clean --purge` yol modunu kaldır; yalnız `vaultItemId` | Planlı (3.0) |
| B13 | Disk kümeleri + proje artefaktlarını grafa bağla | Planlı |
| B14 | Yol+mtime boyut önbelleği + worker thread | Planlı |
| B15 | Yüksek risk override + denetim UI | Planlı (T44) |
| B16 | Plan motoruna konsolidasyon/env eylemleri | Planlı |
| **T54** | **Eski CLICleaner kalıntılarının temizliği** | **Planlı — hemen değil** |

### T54 — Eski CLICleaner kalıntıları (plana alındı, uygulanmadı)

Tespit (21.10.2026, salt okunur):

| Kalıntı | Durum | Karar |
|---|---|---|
| `C:\Users\Code\source\repos\CLICleaner` | **Duruyor** (boş/kilitli) | Kilit bırakınca sil; içerik doğrulaması yapılmadan silinmez |
| `%LOCALAPPDATA%\clicleaner` | **Yok** (doğrulandı) | Dizin yok; kod koruması **kaldırıldı** (23.10.2026 kullanıcı kararı) |
| npm `clicleaner@1.0.0` | **Deprecate** edildi, mesaj doğru | Korunur (tarihsel) |
| GitHub `omer-denen/CLICleaner` | Yeni repoya **yönleniyor** | Ek işlem yok |
| `src/core/data-dir.ts`, `discover.ts`, `guard.ts`, testler | Eski ad **koruma** amaçlıydı | **Koruma kaldırıldı** (23.10.2026 kullanıcı kararı; yalnız güncel ad korunur) |
| Tarihsel `docs/HANDOVER-*`, `CHANGELOG` | Tarihsel kayıt | Korunur |
| README/CHANGELOG eski ad geçişleri | Kullanıcıya görünen metin | Yalnız gerekliyse "eski ad" notuna çevrilir |

Uygulama sırası: (1) boş klasörü doğrula, (2) sil, (3) `git grep` ile
kalan kullanıcı-görünür metinleri gözden geçir, (4) testler.

---

## 6. Riskler

| Risk | Önlem |
|---|---|
| Arayüzde karar mantığı sızması | Yalnız `id` + sayı tüketilir; PR'da reddedilir |
| Dashboard yanlış toplam | Toplamlar motorda + birim test |
| Ağır tarama tetiklenmesi | Dashboard yalnız önbellek; `ensure()` yok |
| İki profilin dili karışması | Ayrı defterler, ayrı varsayılan eylem |
| Paket boyutu | `dist/web` ölçülür; kaynak haritası kapalı |
