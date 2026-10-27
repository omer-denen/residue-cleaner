# Araçlar (CLI) — Plan Sisteminin Kaldırılması ve Araç Başına Tek İşlem Önerisi

> **Alıcı:** Orkestratör modeli  
> **Yazar:** Tasarım uzmanı (kod + UX değerlendirmesi birleşik)  
> **Durum:** **UYGULANDI (26.10.2026)** — tarihsel tasarım kaydı. Kod alıntıları
> o günkü hâli yansıtır; güncel davranış için `web/src/panel-plan.ts`
> (`tools: { modules: ['evidence', 'action'] }`), `removeSingleTool`
> (`src/actions/cli-remove.ts`) ve `POST /api/cli/remove` bakılır.
> 0.3.0-alpha.0 — kullanıcı kararı (plan sistemi kaldırıldı, araç başına tek işlem).  
> **Bağlı belge:** `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md` (sağ panel statik davranış analizi)

---

## 1. Karar — Neden plan sistemi kaldırılmalı

Kullanıcı geri bildirimi (`npm uninstall` çoklu desteği + `plan` görünümü + sağ panel statikliği bir arada değerlendirildiğinde):

> "Her araç `npm` ile silenecekse plan sisteminin kaldırılmasını; araç başına tek işlem yapılmasını; görünümlerin buna göre düzeltilmesini; kullanıcı deneyimi olarak çoklu değil, ayrı ayrı `uninstall` edilmesi daha doğru olacağı için bu araçlar bölümünü kendi yorumlarını da katıp yaz."

**Uzman değerlendirmesi (kendi yorumum):** Bu talep, `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md`'de (`P1-P5`) tanımlanan "bildirim paneli" sorununun kök nedenlerinden biriyle doğrudan örtüşüyor. `planned` sekmesi (`App.tsx` 605-660) zaten disk planını (`PlanResponse`) gösteriyor; CLI kaldırma planı (`CliPlanResponse`) ise `action` portalına (`RightPanelPortal module="action"`) yükleniyor. Bu iki farklı "plan" kavramının aynı ekranda (`Tools`) karışması, kullanıcı deneyimini bozuyor.

Ayrıca, `cli-removal-service.ts` (`execute`) tek `planId` + tek `phrase` (`SIL`) alıp tüm `plan.items`'i döngüyle (`for`) çalıştırıyor. Yani teknik olarak zaten **araç başına tek komut çağrısı** (`runProcess`) var. `plan` sistemi burada yalnızca:
- Bağımlılık grafiği (`whatIf`) hesaplamak (`blocked`)
- Yedek (`backup`) hesaplamak
- Onay (`SIL`) toplamak
- TTL (`10 dk`) eklemek

Ama bu avantajlar, `Tools` ekranının sağ panelindeki karmaşa (`planned` vs `action` sekmesi çatışması) ve kullanıcı deneyimi maliyetiyle karşılaştırıldığında, **araç başına basit, doğrudan kaldırma akışı** daha doğru bir UX sunuyor.

---

## 2. Mevcut mimari — neden karmaşık

### 2.1 `App.tsx` — `Tools` ekranı için panel modülleri (`App.tsx` 86-102, 605-660)

```ts
function modulesFor(screen: Screen): RightPanelModuleId[] {
  case 'tools': return ['evidence', 'action', 'planned'];
}
```

- `evidence`: `slot` (`RightPanelPortal`), `detailId` seçili değilse boş (`PanelEmpty`).
- `action`: `plan` (`CliPlanResponse`) varsa gösterilir (`plan-panel`); yoksa boş.
- `planned`: Her zaman `PlannedModule` (disk planı `planned` state) gösterir — `Tools` için anlamsız.

### 2.2 `cli-removal-service.ts` — plan üretimi ve yürütme (`cli-removal-service.ts` 36-171)

```ts
async plan(commands: string[], backup: boolean): Promise<CliPlanResponse> { ... }
async execute(planId: string, phrase: string): Promise<CliExecuteResponse> { ... }
```

- `plan()` bağımlılık grafiği (`buildInventoryGraph`) + `whatIf` + `blocked` hesaplar.
- `execute()` tek `phrase` (`SIL`) doğrular, tüm `items`'ı tek tek çalıştırır (`runProcess`).
- `results[]` her araç için ayrı sonuç (`ok`, `verified`, `backupDir`).

### 2.3 `cli-remove.ts` — yürütme (`cli-remove.ts` 165-248)

```ts
for (const item of plan.items) {
  const r = await runProcess(tool.uninstall.program, tool.uninstall.args);
  ...
  out.push({ command, ok: r.code === 0, verified, ... });
}
```

Her öğe ayrı `runProcess`. `npm uninstall -g ${name}` (`cli-inventory.ts` 365) tek paket. Yani `plan` sistemi, **çoklu silme komutunu birleştirmiyor**, sadece toplu karar kapısı (`SIL`) ve toplu bağımlılık kontrolü sunuyor.

---

## 3. Önerilen yeni mimari — plan kaldırılacak, araç başına tek işlem

### 3.1 `cli-removal-service.ts` — `plan()` ve `execute()` kaldırılacak (`cli-removal-service.ts`)

- `CliPlanResponse`, `CliPlanItemView`, `CliRemovalPlan`, `CliRemovalItem` türleri (`core/contract.ts` 964-977) kaldırılacak.
- `plan()` yerine: doğrudan seçilen aracın (`CliTool`) kaldırılabilirliğini (`uninstall !== null`, `status !== 'protected'`) kontrol et.
- `execute()` yerine: doğrudan tek `CliTool` için `runProcess(tool.uninstall.program, tool.uninstall.args)` çağrısı. `phrase` (`SIL`) doğrudan bu tek işlem için sorulacak.

**Gerekçe:** `plan` sistemi zaten her öğeyi ayrı çalıştırıyor (`for` döngüsü). `SIL` topluluğu burada kullanıcı deneyimini zorlaştırıyor; tek araç için tek `SIL` daha anlaşılır.

### 3.2 `cli-remove.ts` — `executeCliRemoval()` sadeleştirilecek (`cli-remove.ts`)

- `executeCliRemoval()` (`cli-remove.ts` 165) yerine `removeSingleTool(tool: CliTool)`:
  - `backup` (`executeToolBackup`) — opsiyonel, kullanıcı seçimine bağlı.
  - `uninstall` komutu (`runProcess`) — tek çağrı.
  - `verified` (`packageGone` + `shimPointsTo`) — tek araç için tek kontrol.
  - `repair` (`reinstallSpec`) — tek araç için tek onarım.
- `planCliRemoval()` (`cli-remove.ts` 60) kaldırılacak; `items` dizisi ve `blocked` dizisi (`whatIf`) kalkacak.
  - **Not:** Bağımlılık (`blocked`) kontrolü, tek araç kaldırıldığında gereksizdir. Eğer kullanıcı bir aracı seçtiyse, o aracın bağımlılığı kendisiyle ilgili değil; başka bir aracın bağımlılığı olarak kalabilir. Bu kontrol toplu planda anlamlıydı; tek işlemde gereksiz.

### 3.3 `Tools.tsx` — sağ panel (`action` portalı) sadeleştirilecek (`Tools.tsx` 561-840)

Mevcut durum (`Tools.tsx`):
- `plan` (`CliPlanResponse`) varsa `action` portalında `plan-panel` (`items` listesi, `blocked`, `approval-row`, `execute` düğmesi) gösteriliyor.
- `results` (`CliExecuteResponse`) varsa `plan-panel` başarı/başarısız sonuçlarını listeliyor.

Yeni durum (`plan` kaldırılınca):
- `RightPanelPortal module="action"` (`Tools.tsx` 814): `plan` yerine doğrudan tek araç kaldırma akışı.
- `action` portalı (`App.tsx` `modulesFor('tools')`) artık sadece tek işlem durumunu gösterecek.
- `evidence` (`detailId`) zaten çalışıyor (`RightPanelPortal module="evidence"`, `when={detail !== null}`). Bu kalacak.
- `planned` (`App.tsx` `modulesFor('tools')`) `Tools` ekranından çıkarılacak veya `Tools` için `planned` sekmesi kaldırılacak. Çünkü `planned` (`PlannedModule`) disk tarama planı; CLI kaldırma ile ilgisi yok.

**Görsel düzeltme (`styles.css`):** `rp-planned` (`styles.css` 970) `Tools` ekranında artık görünmeyecek. `action` portalının (`plan-panel`) görsel düzeni (`plan-panel`, `approval-actions`, `approval-row`) tek araç için sadeleştirilecek (örneğin `items` listesi yerine tek `command` + `uninstallCommand` gösterimi).

### 3.4 `App.tsx` — `Tools` için panel modülleri (`App.tsx` 86-102, 605-660)

Mevcut:
```ts
case 'tools': return ['evidence', 'action', 'planned'];
```

Yeni:
```ts
case 'tools': return ['evidence', 'action'];  // 'planned' kaldırıldı
```

`action` portalı (`RightPanelPortal module="action"`) artık `plan` (`CliPlanResponse`) yerine tek işlem durumunu (`removing`, `done`, `error`) alacak. `planned` (`PlannedModule`) `Tools`'ta artık basılmayacak.

---

## 4. Görünümlerin nasıl düzeltilmesi gerektiği (`Tools.tsx` odaklı)

### 4.1 Seçim (`selected`) ve `plan` yerine tek işlem (`Tools.tsx` 64-201)

Mevcut:
- `selected: Set<string>` (çoklu seçilebilir). `createPlan()` (`satır 185`) `api.cliPlan({ commands: [...selected] })` çağırıyor.

Yeni:
- `selected` tek bir `string` (`id`) olacak (`Set` kaldırılacak veya tek eleman sınırlandırılacak).
- `createPlan()` yerine `removeTool()` (`satır 185` değişecek): `api.cliRemove({ id: selected })` veya doğrudan `runProcess` çağrısı.
- `selectVisible()` (`satır 176`) kaldırılacak; yalnızca tek tıklama (`toggle`) kalacak.
- `clear` (`satır 439`) kaldırılacak (artık tek seçim, `clear` gereksiz).

### 4.2 Eylem paneli (`action` portalı) (`Tools.tsx` 561-840)

Mevcut (`plan` varken):
- `plan-panel` (`h2`: `Plan başlığı`, `meta-list`: `items`, `total`, `backup`, `detail-list`: her öğe için `command` + `uninstallCommand`, `blocked` listesi, `approval-row`: `phrase` girişi, `approval-actions`: `Planı uygula` + `Geri`).

Yeni (`plan` yok, tek işlem):
- `action` portalı (`RightPanelPortal module="action"`) `Tools.tsx` içinde:
  - Eğer `removing` durumunda (`useState`): ilerleme (`runProcess` çıktısı).
  - Eğer `done`: tek sonuç (`ok`, `verified`, `backupDir`).
  - `approval-row`: Tek `SIL` (`phrase`) girişi.
  - `approval-actions`: `Sil` (`danger-button`) düğmesi (tek işlem).
- `items` listesi (`plan.items.map`) kalkacak; yerine tek araç bilgisi (`detail.command`, `uninstall.display`) gösterilecek.
- `blocked` listesi (`plan.blocked`) kalkacak (bağımlılık kontrolü artık tek araç için gereksiz).

### 4.3 `plan` (`CliPlanResponse`) ve `results` (`CliExecuteResponse`) yerine tek durum (`Tools.tsx` 76-80)

Mevcut:
```ts
const [plan, setPlan] = useState<CliPlanResponse | null>(null);
const [results, setResults] = useState<CliExecuteResponse | null>(null);
```

Yeni:
```ts
const [removing, setRemoving] = useState<string | null>(null);  // aktif kaldırılan aracın id'si
const [result, setResult] = useState<{ ok: boolean; verified: boolean; output: string; backupDir?: string; manual?: boolean } | null>(null);
```

`execute()` (`satır 203-223`) yerine `removeSingle(id: string)`:
- `ApprovalRules.matches('delete', phrase)` tek `SIL` doğrulaması.
- `runProcess` çağrısı (`cli-remove.ts`).
- `verified` ve `backupDir` tek araç için.

---

## 5. Uzmanın kendi yorumu — neden bu daha doğru

Kullanıcının gözlemi (`Araçlar` sağ panel statik, `planned` disk planıyla karışıyor, `npm` doğal çoklu desteği kullanılmıyor) ve mimari analiz (`RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md`) bir arada değerlendirildiğinde:

1. **`plan` sistemi (`CliPlanResponse`) zaten teknik olarak çoklu silmeyi birleştirmiyor.** `cli-remove.ts` (`executeCliRemoval`) `for (const item of plan.items)` ile her öğeyi ayrı `runProcess` çağrısıyla çalıştırıyor. `npm uninstall -g pkg1 pkg2` gibi tek komut üretimi yok. Yani `plan` sistemi, kullanıcıya "toplu silme" vaadi sunuyor gibi görünüyor (`Plan` düğmesi, `plan.items` listesi), ama arka planda zaten ayrı ayrı çalışıyor.

2. **Bu "yanıltıcı UX" (`false promise`).** Kullanıcı `Plan` düğmesine tıklayıp `SIL` yazdığında, tek bir komut çalışacağını sanabilir; ama aslında her araç için ayrı komut çalışıyor. Bu, `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md`'de (`P1-P5`) tanımlanan "statik panel / bildirim paneli" sorununun `Tools` ekranındaki yansıması.

3. **`planned` (`PlannedModule`) sekmesi `Tools`'ta anlamsız.** `App.tsx` (`modulesFor('tools')`) `planned`'i `Tools` için de açıyor. Ama `planned` (`PlannedModule`), disk tarama planını (`PlanResponse`) gösteriyor. `Tools` ekranında kullanıcı CLI aracını kaldırmayı planlıyor; disk planıyla hiçbir ilgisi yok. Bu, sağ paneldeki `planned` sekmesinin `Tools` için "boş içerik" veya "yanlış bağlam" sunmasına neden oluyor.

4. **Ayrı ayrı işlem (`per-tool`) daha doğru UX sunuyor:**
   - Her araç için ayrı `SIL` (`sil` yazılı onayı) yazmak, kullanıcıya "bu aracı gerçekten silmek istiyorum" mesajını net verir.
   - `results` her araç için ayrı (`ok`, `verified`, `manual`) — kullanıcı hangi aracın silindiğini, hangisinin başarısız olduğunu net görür.
   - `action` portalı (`RightPanelPortal module="action"`) artık tek araç için sade (`command`, `uninstall.display`, `Sil` girişi, `Sil` düğmesi) — `planned` sekmesinin karmaşıklığı (`items` listesi, `blocked`, `approval-row`, `plan.panel` rozetleri) ortadan kalkar.

5. **`npm` doğal çoklu desteği kullanılmıyorsa (`cli-inventory.ts` 365), toplu planın teknik avantajı kalmıyor.** `plan` sisteminin tek gerçek avantajı bağımlılık (`blocked`) kontrolü ve toplu yedek (`backup`) hesaplamasıydı. Ama `npm uninstall -g pkg` tek paket için oluşturulduğundan, `plan` sistemi zaten bu avantajı `runProcess` seviyesinde sağlayamıyor.

**Sonuç:** `plan` sistemi (`CliPlanResponse`, `CliPlanItemView`, `CliRemovalPlan`, `planCliRemoval`, `executeCliRemoval`) `Tools` ekranından çıkarılmalı; yerine tek araç kaldırma (`single tool removal`) akışı (`tools-detail` veya `action` portalı üzerinden) getirilmeli. Görünümler (`styles.css`, `App.tsx`, `Tools.tsx`) buna göre sadeleştirilmeli.

---

## 6. Uygulama sırası (Orkestratör için)

| Adım | Dosya | Değişiklik |
|---|---|---|
| 1 | `src/core/contract.ts` | `CliPlanResponse`, `CliPlanItemView`, `CliRemovalPlan`, `CliRemovalItem` kaldır |
| 2 | `src/services/cli-removal-service.ts` | `plan()` ve `execute()` kaldır; yerine `removeSingle(id: string, phrase: string)` |
| 3 | `src/actions/cli-remove.ts` | `executeCliRemoval()` kaldır; `removeSingleTool()` ekle (tek `runProcess`) |
| 4 | `src/core/cli-inventory.ts` | `uninstall` (`npm`) tek paket olarak kalacak (`name` tek); çoklu komut üretimi gereksiz |
| 5 | `web/src/screens/Tools.tsx` | `selected` (`Set`) → tek `string` (`id`); `createPlan()` → `removeSingle()`; `plan` state (`CliPlanResponse`) → `removing` + `result` state; `RightPanelPortal module="action"` sadeleştir (`plan-panel` yerine tek işlem paneli) |
| 6 | `web/src/App.tsx` | `modulesFor('tools')`: `['evidence', 'action']` ( `planned` kaldırıldı) |
| 7 | `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md` | `P1-P5` güncelle (bu yeni karar doğrultusunda `planned` `Tools` ekranından kalktı) |

---

*Bu belge, kullanıcının `Araçlar` (`Tools`) geri bildirimi (`plan` statik/hatalı, `npm` çoklu destek yok, sağ panel karmaşıklığı), `cli-remove.ts` kod analizi (`runProcess` tek çağrı, `for` döngüsü zaten ayrı çalıştırma), `cli-inventory.ts` (`npm uninstall -g ${name}` tek paket) ve önceki `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md` (`P1-P5`, `App.tsx` `panelModules` statik davranış) birleştirilerek hazırlanmıştır. Plan modunda tartışıldı, değişiklik talebi doğrulandı.*

**Uygulama durumu (26.10.2026):** §6'daki 1-7 adımlarının tamamı uygulandı;
`CliPlanResponse`/`CliPlanItemView`/`planCliRemoval`/`executeCliRemoval` ve
`/api/cli/plan`, `/api/cli/execute` koddan kaldırıldı. Ayrıntı ve test kanıtı:
`AGENTS.md` §9 ve `docs/ORCHESTRATOR-LOG.md`. Bu belge artık **karar kaydıdır**,
uygulama rehberi değildir.
