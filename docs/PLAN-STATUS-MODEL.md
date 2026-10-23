# Plan Durumu — tek aktif plan modeli (23.10.2026)

> Kullanıcı kararı. Bu belge **karar kaydıdır**; uygulama sırası
> `docs/ORCHESTRATOR-LOG.md` ve `SESSION_LOG.md`'dedir.

## Neden bu model

İlk öneri kalıcı, adlandırılmış **çoklu plan koleksiyonu** idi. Kullanıcı
"daha kolay olursa" diyerek **tek aktif plan + değiştirme onayı** modelini
seçti. Böylece:

- disk öğeleri için **tek plan** vardır → "bir öğe iki planda olamaz" kuralı
  yapısal olarak sağlanır, çapraz plan taşıma/çakışma sorunu doğmaz,
- plan yine **10 dakikalık TTL** ile yaşar (güvenlik: bayat plan uygulanamaz),
- "Planı uygula" dediğinde yürütme planı **güncel taramadan** kurulur,
- araçlar planı **kendi ekranında** ayrı yaşar; disk planıyla karışmaz.

## Kavramlar

| Kavram | Nerede | Ömür | Onay |
|---|---|---|---|
| **Aktif plan** (disk) | `DeleteService.plans` (bellek) | 10 dk TTL + kimlik | `TASI` / `SIL` |
| **Araçlar planı** | `CliRemovalService` (bellek) | TTL | `SIL` |
| **Yürütme planı** | `POST /api/execute` | plan anı | yazılı ifade + yüksek risk işareti |

Disk planı **kalıcı değildir**: uygulama kapanınca veya TTL dolunca biter.
Kalıcı plan koleksiyonu bilinçli olarak **yapılmadı** (beta sonrası).

## Davranış

1. **Checkbox = plana ekle.** İşaretlenen küme `POST /api/plan/add` ile aktif
   plana girer; plan yoksa tek öğeyle kurulur. `planId`, `createdAt` ve TTL
   **korunur**; aynı öğe tekrar eklenirse **idempotent** (değişmez).
2. **Planlı satır kilitlidir.** Checkbox `disabled`, satır accent zemin + sol
   çizgi, rozet **"Plana Eklendi"**. Kaldırma:
   - satırda **"Plandan çıkar"** (`removeFromPlan(key)`),
   - panelde hedef `×` veya küme başlığından çıkarma.
3. **Ad.** Plan adı sunucuda (`PlanResponse.name`) tutulur; **"Kaydet"** ile
   `PATCH /api/plan/:id`. Ad boşsa arayüz "Plan adı" yer tutucusunu gösterir.
4. **Değiştirme onayı.** Planda öğe varken **"Yeni plan"**:
   *"Mevcut plan var — N öğe · X GB. Değiştirmek ister misiniz?"*
   → **Yeni plan** / **Vazgeç**. Onay, planı boşaltır (`clearPlan`), satır
   işaretleri kalkar.
5. **"Planı uygula"** yalnız **Plan ekranına** gider; hiçbir şey çalıştırmaz.
   Yürütme, Plan ekranındaki yazılı onaydan sonra olur.
6. **Araçlar planı** panelde ayrı bölüm: salt okunur özet + "Araçlar'a git".
   İkinci bir plan kopyası tutulmaz.
7. **Boş durum:** panel gövdesi **"Henüz öğe seçilmedi"**.
8. **Varsayılan seçim yok.** Plan, kullanıcı işaretiyle doğar; açılışta boştur.
   Toplu düğmeler yalnız **ekler**: "Varsayılanı plana ekle",
   "Görünenleri plana ekle"; "Planı boşalt" temizler.

## Güvenlik çizgisi (değişmedi)

- Silme hedefi üretimi yalnız `buildPlan` + `guard.ts` üzerinden.
- Plandan çıkarma/boşaltma **disk üzerinde hiçbir etki** yapmaz.
- Yürütme için yazılı ifade (`TASI`/`SIL`) ve yüksek risk işareti zorunlu.
- Plan öğeleri **yol değil anahtar** ile taşınır; istemci yol göndermez.

## API yüzeyi

| Uç | Amaç |
|---|---|
| `GET /api/plan` | aktif plan (TTL süzgeçli) |
| `POST /api/plan` | yeni plan (anahtarlar) — değiştirme onayı arayüzde |
| `POST /api/plan/add` | aktif plana ekleme (kimlik/TTL korunur) |
| `POST /api/plan/remove` | `key` / `keys[]` / `targetId` çıkarma |
| `PATCH /api/plan/:id` | ad |
| `POST /api/execute` | onaylı yürütme (değişmedi) |

## Açık kalan (bilinçli)

- Plan **kalıcı değil**: yeniden başlatmada kaybolur.
- Çoklu plan / plan arşivi yok (istenirse ayrı milestone: `store/plans.ts`).
- Araçlar planı panelde **özetlenmez**; yalnız yönlendirme vardır.

## 24.10.2026 güncellemesi (yürürlükte)

- **Ömür**: 10 dakika **uygulama anında** başlar. Seçim sırasında süre
  baskısı yok; içerik değişince `armed = false` ve TTL yenilenir.
- **Uygulanmamış plan her açılışta silinir**: istemci açılışta
  `GET /api/plan`; `armed === false` ise `POST /api/plan/discard`.
  `armed === true` plan 10 dk boyunca geri yüklenebilir.
- **Planı uygula** = `POST /api/plan/apply`: plan **güncel taramadan
  yeniden kurulur** (`buildPlan` + `guard`), yeni `planId`, `armed: true`.
  Taramada bulunmayan öğe varsa `409` (gerekçe metni).
- **Kaydet/ad** arayüzden kaldırıldı (10 dk TTL'li planda saklama yok).
  `PATCH /api/plan/:id` sunucuda reserve.
- **Çıkarma tek yerde**: satırda **Plandan çıkar**; panelde tek tek `×`
  yok, yalnız **Tümünü boşalt**.
- **Tarama**: her açılışta tarama (varsayılan); Ayarlar'da
  `Her zaman / Günde bir / Elle`. "Son Tarama" yaşı kaldırıldı; yerine
  **Son Kasa işlemi**. Genel Bakış'ta **silinebilir tüm alan** (kullanımda
  olsun olmasın) ve taranan toplam gösterilir.
- **Kasa fiziksel taşımadır**; aynı diskte olduğu için boş alan ancak
  "Kasayı boşalt" ile artar (kartta "Hâlâ diskte" notu).
