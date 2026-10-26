# Sağ Panel — Dinamik Araç Olma Önerisi

> **Alıcı:** Orkestratör modeli  
> **Kaynak:** Kullanıcı geri bildirimi (menü geçişinde statik kalma, bildirim paneli hissi) + `App.tsx`, `RightPanel.tsx`, `PlannedModule.tsx`, `styles.css` analizi + `docs/UX-PLAN-2026-10-21.md` (P1 açık)  
> **Durum:** 0.3.0-alpha.0 (UI-REDESIGN / T44 sonrası) — bu not yayınlanmamış durum için hazırlanmıştır

---

## 1. Kullanıcının gözlemi (doğrudan alıntı)

> "Menüler arası geçişte sağ panel static kalıyor, ilgili menünün durumunu yansıtmıyor, dinamik bir araç olmaktan çok bir bildirim paneli gibi çalışıyor."

Bu gözlem `App.tsx`'te (`panelModules`, `modulesFor`) ve `PlannedModule.tsx`'te (`rp-planned`) somut olarak doğrulanıyor.

---

## 2. Mevcut durum — kod kanıtı

### 2.1 Panel modülleri ekrana göre sabit liste (`App.tsx` satır 86-102)

```ts
function modulesFor(screen: Screen): RightPanelModuleId[] {
  switch (screen) {
    case 'dashboard':
    case 'disk':
    case 'projects':
      return ['evidence', 'planned'];  // Her zaman aynı ikili
    case 'tools':
      return ['evidence', 'action', 'planned'];
    case 'env':
    case 'graph':
      return ['action', 'planned'];
    case 'plan':
      return ['context'];
    default:
      return ['planned'];  // Diğer tüm ekranlarda sadece "Planlanmış"
  }
}
```

**Sonuç:** Menü (`rail`) değişince sekme başlıkları (`evidence`, `planned`) değişiyor ama **içerik bağlamı** aynı kalıyor. `planned` sekmesi `Dashboard`'ta da, `Tools`'ta da, `Projects`'te de aynı `PlanResponse` widget'ını (`PlannedModule`) basıyor.

### 2.2 `panelModules` — statik içerik üretimi (`App.tsx` satır 605-660)

- `evidence`: `slot: true` → `Disk` ekranından `RightPanelPortal` ile geliyor. Ama `Dashboard`, `Projects`, `Tools` ekranları bu porta zorunlu içerik basmadığı için `SlotHost` boş durum (`PanelEmpty`: "Bir şey seçin") gösteriyor.
- `planned`: `badge: planned?.panel.clusterCount ?? null` + sabit `<PlannedModule .../>` içeriği. **Ekran verisiyle hiçbir dinamik bağlantı yok.**
- `action`: `tools`/`env`/`graph` için var ama yine portal tabanlı; `env`'in PATH bulguları, `graph`'ın bağımlılık engeli bu sekmeye dinamik yansımıyor.
- `context`: Sadece `plan` ekranı; `Dashboard`'ta `footer` (`ContextBlock meta={meta}`) olarak görünüyor.

### 2.3 `planned` — bildirim paneli davranışı (`PlannedModule.tsx`)

`rp-planned` bölümü (`styles.css` satır 970-1213):
- Üst blok `sticky`: `rp-plan-head` (eylem düğmeleri + özet + geçerlilik)
- Alt blok: `rp-planned-groups` (katlanabilir gruplar) + `rp-planned-tools` (yönlendirme)

Bu yapı **ekrandan bağımsız** bir sistem bildirimi gibi çalışıyor. Kullanıcı `Dashboard`'ta da `Disk`'te de aynı "Plan Durumu" widget'ını görüyor.

### 2.4 Görsel hiyerarşi — statik hissi (`styles.css`)

- `.right-panel` (`bg-soft`): Menüye bağlı değişmeyen arka plan
- `.rp-tabs`: Sekme geçişleri (`box-shadow: inset 0 -2px 0 var(--accent)`) çalışıyor ama sekme içeriği statik
- `.panel-resizer`: `300-560px` arası sürükleme (`pointer` olayları) var (`App.tsx` 517-554) — bu iyi; ama panel içeriği genişliğe uyum sağlasa da bağlama uyum sağlamıyor.

---

## 3. Tasarım uzmanı değerlendirmesi

| Boyut | Mevcut durum | Dinamik olması için gereken |
|---|---|---|
| **Modül seçimi** | `modulesFor(screen)` sabit liste | Ekran durumu (`DashboardResponse`, `CliView`, `EnvResponse`, `GraphResponse`) modülleri tetiklemeli |
| **Kanıt (`evidence`)** | Portal (`when`) boş kalabiliyor; `EmptyState` ("Bir şey seçin") sık görülüyor | Ekranın birincil verisi (kümeler, araçlar, projeler) her zaman bir kanıt paneli üretmeli; boş durum nadiren görünmeli |
| **Plan (`planned`)** | Tüm ekranlarda aynı `PlanResponse` (`planned` state) | `Dashboard`: plan rozet + kısa özet; `Disk`: "bu küme planda mı?"; `Tools`: "bu araç planda mı?" — ekran bağlamıyla yeniden şekillenmeli |
| **İşlem (`action`)** | Sadece `tools`/`env`/`graph` için statik slot | `Tools`: silme planı (`SIL`); `Env`: ortam değişikliği (`TEMIZLE`); `Graph`: bağımlılık engeli — ekran verisinden türemeli |
| **Bağlam (`context`)** | Sadece `plan` ekranı; diğerlerinde `ContextBlock` footer'da | `Dashboard`: tarama durumu + kapsam bağlamı; `Disk`: seçili küme bağlamı — bağımsız sekme veya zengin footer olmalı |
| **Sekme sırası (`rightTab`)** | Ekran değişince sıfırlanıyor (`primary = modulesFor(screen)[0]`) | Ekran içi seçim değişince (`plannedKeys`, seçili araç) `rightTab` güncellenmeli |

**Temel sorun:** Panel "ekranların ortak bağlamı" değil, "her ekranın kendi durumunun görsel yansıması" olmalı. `planned` sekmesi şu anda bir "bildirim widget'ı" gibi davranıyor; kullanıcı `Dashboard`'ta da `Tools`'ta da aynı bilgiyi görüyor.

---

## 4. Nasıl olmalı? — Öneriler (öncelik sırasıyla)

### P1 — `planned` sekmesi ekran bağlamına duyarlı (`PlannedModule` güncellemesi)

**Mevcut:** `PlannedModule` yalnızca `PlanResponse` alıyor.  
**Olmalı:** `App.tsx`'ten ekran durumu (`screen`, `plannedKeys`, `dashboard?.ledgers`, `status`) da geçirilmeli.

Örnek davranış:
- `Dashboard`: Plan sayısı kompakt rozet (`badge`) + kısa özet; "Güvenli Kazanımlar" sekmesi (`evidence`) daha baskın
- `Disk`: `plannedKeys` ile karşılaştırma — "Seçili küme planda mı? → Evet/Hayır + plandaki hedef sayısı"
- `Tools`: Seçili araç (`cli-inventory` sonucu) plandaki bir hedef mi? → Rozet veya durum metni
- `Plan`: `context` sekmesi (`ContextBlock`) zengin bağlam (meta + tarama durumu)

**Görsel etki:** `planned` artık sabit bir bildirim değil, ekranın o andaki verisiyle yeniden şekillenen bir bağlam olur.

### P2 — `evidence` portalı her ekranda aktif (`App.tsx` + ekran bileşenleri güncellemesi)

**Mevcut:** `Disk`, `Dashboard`, `Projects` ekranları `RightPanelPortal` kullanıyor ama portal boş kalırsa `PanelEmpty` gösteriyor.  
**Olmalı:** Her ekran kendi birincil verisini (`Disk`: seçili küme detay; `Dashboard`: güvenli kazanım özeti; `Projects`: seçili proje detayı; `Tools`: seçili araç envanteri) zorunlu olarak `evidence` slotuna basmalı. Boş durum (`emptyKind`) sadece gerçekten "hiçbir veri yok" durumunda görünmeli.

**Görsel etki:** Menü değişince sağ panel hemen yeni ekranın kanıtını gösterir; kullanıcı "burada bir şey bekleniyor" hissinden kurtulur.

### P3 — Sekme sırası (`rightTab`) ekran içi seçimle güncellenmeli

**Mevcut:** `App.tsx` 177-183 — sadece `screen` değişince sıfırlanıyor.  
**Olmalı:**
- `Disk`: `plannedKeys` değişince (`onPlan`) `rightTab` otomatik `evidence` veya `planned`'e geçebilir
- `Tools`: Envanter sonucu (`inventory`) güncellenince `evidence` sekmesine geçiş
- `Env`: PATH/ortam değişikliği (`env-plan`) uygulanınca `action` sekmesine geçiş
- `Graph`: `whatIf` sonucu gelince `action` sekmesine geçiş

**Görsel etki:** Panel, kullanıcı etkileşimine yanıt veriyor gibi hisseder; statik kalmaz.

### P4 — `planned` içeriği görsel olarak sadeleştirilmeli (`PlannedModule` + `styles.css`)

`rp-planned` (`styles.css` 970-1213) şu an oldukça yoğun:
- `rp-plan-head` (sticky eylem + özet + geçerlilik)
- `rp-planned-groups` (katlanabilir gruplar)
- `rp-planned-tools` (yönlendirme)

**Öneri:** Ekran bağlamına göre bu bölümler dinamik gösterilmeli:
- `Dashboard`: Sadece `rp-planned-summary` (rozet + sayılar) + kısa `rp-planned-tools` ("Disk'e git")
- `Disk`: Tam `rp-planned-groups` + `rp-plan-head` (eylem düğmeleri aktif)
- `Tools`/`Projects`: `rp-planned` kompakt (badge + kısa özet) — kullanıcı o ekranda plan durumu değil, kendi verisini görmek istiyor olabilir

### P5 — `context` sekmesi genişletilmeli (`App.tsx` + `ContextBlock`)

**Mevcut:** Sadece `plan` ekranında `context`; diğerlerinde `ContextBlock` footer'da (`evidence` sekmesinin altında).  
**Olmalı:** `Dashboard` için `context` bağımsız sekme (tarama durumu + kapsam); `Disk` için seçili küme bağlamı (`evidence` footer'ı yerine bağımsız sekme); bu, panelin "modül yüzeyi" kimliğini güçlendirir.

---

## 5. Özet — Orkestratör için aksiyon listesi

| Öncelik | Görev | Etkilenen dosyalar | Görsel sonuç |
|---|---|---|---|
| P1 | `planned` ekran bağlamına duyarlı (`plannedKeys`, `dashboard`, `status` ile zenginleştirme) | `App.tsx`, `PlannedModule.tsx` | Panel artık sabit bildirim değil, ekran verisiyle şekillenen bağlam |
| P2 | `evidence` portalı zorunlu içerik (`Disk`, `Dashboard`, `Projects`, `Tools`) | `App.tsx`, `screens/*`, `components/RightPanel.tsx` | Menü değişince panel hemen yeni kanıtı gösterir |
| P3 | `rightTab` ekran içi seçimle güncelleme (`plannedKeys`, envanter, env-plan, what-if) | `App.tsx` | Panel kullanıcı etkileşimine dinamik yanıt verir |
| P4 | `planned` içeriği görsel sadeleştirme (ekrana göre bölüm gizleme/gösterme) | `PlannedModule.tsx`, `styles.css` | Daha az görsel karmaşa; ekran odaklı bilgi yoğunluğu |
| P5 (planlı) | `context` sekmesi genişletme (`Dashboard`, `Disk`) | `App.tsx`, `ContextBlock.tsx` | Modül yüzeyi kimliği güçlenir |

---

## 6. Not — Mimari kural hatırlatması (`AGENTS.md` 11, 12, 18)

- **Karar (modül seçimi, içerik zenginleştirme) `App.tsx` veya motor (`src/core/`) tarafında verilmeli;** `RightPanel` (`RightPanel.tsx`) yalnızca sunum (`tab`, `portal`, `slot`, `empty`) olmalı.
- **`planned` içeriği `App.tsx`'ten dinamik veri (`screen` bağlamı) ile beslenmeli;** `PlannedModule` saf sunum kalmalı.
- **Görsel değişiklik (`styles.css`) motor kararlarını (ekran bağlamına göre bölüm gizleme) desteklemeli;** kendi başına karar üretmemeli.

---

*Bu not, kullanıcı geri bildirimi (`bildirim paneli` gözlemi) üzerine tasarım uzmanı değerlendirmesi (`App.tsx` kod kanıtı, `styles.css` görsel analiz, `docs/UX-PLAN-2026-10-21.md` P1 açık) ve `AGENTS.md` mimari kuralları (`kural 11, 12, 18`) birleştirilerek hazırlanmıştır. Yayınlanmamış 0.3.0-alpha.0 durumu için tasarlanmıştır.*

---

## 7. Güncel durum (26.10.2026) — CLI kaldırma planı uygulandı

`docs/CLI-REMOVE-PLAN-REMOVAL.md` uygulandı: CLI kaldırma plan sistemi (`CliPlanResponse`, `CliPlanItemView`, `planCliRemoval`, `executeCliRemoval`, `/api/cli/plan`, `/api/cli/execute`) kaldırıldı; yerine araç başına tek işlem (`removeSingleTool`, `/api/cli/remove`) geldi. `Tools` ekranında `planned` sekmesi (disk planı) kaldırıldı; panel modülleri `['evidence', 'action']`. Phrase onayı (`SIL`) artık tek araç için. Smoke + typecheck + 407/407 test geçti.
