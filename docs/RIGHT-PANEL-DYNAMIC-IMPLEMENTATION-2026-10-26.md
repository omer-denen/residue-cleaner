# Sağ Panel Dinamik Orkestrasyon — Uygulama Kaydı (P1–P5)

> **Tarih:** 26.10.2026 · **Durum:** Uygulandı, gates geçti (typecheck, 407/407 test, build, smoke, gerçek tarayıcı @1440 TR/EN).  
> **Kaynak:** `docs/RIGHT-PANEL-DYNAMIC-ORCHESTRATOR.md` (P1–P5).  
> **Sürüm:** 0.3.0-alpha.0 (yayınlanmamış).

## 1. Karar tek yerde: `web/src/panel-plan.ts`

Eski `modulesFor(screen)` (App.tsx) her ekran için sabit modül listesi üretiyordu. Yeni saf TS modülü tek kaynaktır:

- `PanelScreen`, `PanelModuleId`, `PlannedVariant`, `PanelPlan`
- `PANEL_SCREENS`, `panelPlanFor(screen)`, `primaryModuleFor(screen)`

Modül matrisi:

| Ekran | Modüller (sıra) | Plan varyantı |
|---|---|---|
| dashboard | evidence · planned · context | compact |
| disk | evidence · planned · context | **full** |
| projects | evidence · planned · context | compact |
| tools | evidence · action · planned | compact |
| env | action · planned · context | compact |
| graph | action · planned · context | compact |
| plan | context | — |
| schedules | context | — |
| vault | context | — |
| settings | context | — |

Kurallar: ilk modül birincildir; ≤3 modül; tekrar yok; `planned` hiçbir ekranda birincil değil; kayit/ayar ekranlarında `planned` yok (yerine `context`); `planned !== null` ⇔ `modules` içinde `'planned'` var.

## 2. P1 — Plan modülü ekran bağlamına duyarlı (varyant)

`PlannedModule`'e `variant: PlannedVariant` eklendi (`full` varsayılan):

- `full`: eylem + özet + kümeler listesi + "Araçlar" bölümü (`Disk`).
- `compact`: eylem + özet + "Disk'e git" düğmesi + tek cümle not (`Küme listesi ve satır çıkarma Disk ekranında yapılır.`); kümeler listesi ve "Araçlar" basılmaz.

Varyant `panel-plan.ts` kararidir (kural 18); `App.tsx` yalnızca `panelPlan.planned ?? 'full'` iletir.

## 3. P2 — Kanıt modülü her ekranda aktif

`PanelSummary` (yeni, `web/src/components/PanelSummary.tsx`) "Kanitlar" modülü seçili değilken ekranın birincil verisini kompakt istatistik listesi olarak basar (başlık + tek cümle + `<dl>` + kapanış notu + isteğe bağlı CTA). Hesap yok; sayılar motordan (`counts`, `summary`, `totals`, `ProjectList.summary`).

Portal koşulları:
- `Dashboard`: `detail === null` → `DashboardTotalsView` (kümeler, dosyalar, taranan alan, geri kazanılabilir, verdict sayıları).
- `Disk`: `detail === null && view !== null && !scanning` → `DiskView` (kümeler, dosyalar, toplam, geri kazanılabilir, seçili, verdict sayıları). Tarama sürerken eski sayılar gizlenir.
- `Projects`: `selected === null && list !== null` → `ProjectList.summary`.
- `Tools`: `detail === null && view !== null` → `CliView.summary`.

## 4. P3 — Sekme sırası ve modül planı

`App.tsx` `modulesFor` kaldırıldı. `panelModules` artık `panelPlanFor(screen).modules`'den eşlenir (etiket, slot, rozet, içerik). `rightTab` ekran değişince `primaryModuleFor(screen)` ile açılır. Modül kimlikleri motor kararından gelir; arayüz hesap yapmaz.

## 5. P4 — Görsel sadeleştirme

- `.rp-planned.is-compact` aralık daraltma; `.rp-planned-note` ayrı stil.
- `.rp-summary`, `.rp-summary-stats`, `.rp-summary-stats dd.tone-*`, `.rp-summary-note`, `.rp-summary-action`.
- `.rp-context-inner` bolum aralığı ve ince çizgi.
- `.rp-context` üst çizgi yalnızca `.rp-footer .rp-context` içinde (bağımsız sekmede çizgi yok).

## 6. P5 — `context` sekmesi genişletildi

`ContextBlock` genişletildi: `status?: ScanStatusResponse | null`, `headingLevel?: 'h2' | 'h3'`. İçerik:
- Tarama: durum, son tarama, yaş, önbellek süresi, taranan küme (ton motordan).
- Güvenlik: `safety.title/body` + sunucu bloğu (`context.meta`, `context.ui`, `context.cwd`, `context.home`, `context.version`).

Yerleşim:
- Bağımsız `context` sekmesi olan ekranlarda (`context` modülü listede): `ContextBlock` modül içeriği; footer TEKRAR basılmaz.
- `context` sekmesi olmayan ekranlarda (`tools`): `ContextBlock` Kanitlar modülünün footer'ı; üst çizgi footer'da.
- Kayit/ayar ekranlarında (`plan`, `schedules`, `vault`, `settings`): tek modül `context`.

Başlık hiyerarşisi: standalone `h2` → `h3`; footer `h3` → `h4` (a11y).

## 7. Plan süresi doldu bannerı

Koşul: `planExpired && screen !== 'plan' && !(rightTab === 'planned' && panelPlan.planned !== null)`. Plan Durumu sekmesi açıkken panelin kendi uyarısı gösterilir; çiftelemeyi önler.

## 8. Doğrulama

- `npm run typecheck`: temiz (src + web).
- `npm test`: 407/407 (10 yeni: `tests/panel-plan.test.ts`).
- `npm run build:web`: 486.14 KB JS / 56.67 KB CSS.
- `npm run smoke`: 34/34.
- Gerçek tarayıcı (ego-browser, 1440 TR/EN): 10 ekranın tamamı gezildi; sekme kümeleri, birincil modüller, özet istatistikleri, kompakt/tam plan, bağımsız Baglam sekmesi ve footer çizgisi doğrulandı. 1024 genişlikte panel CSS ile gizlenir. EN etiketleri doğrulandı.

## 9. Değişen dosyalar

Yeni: `web/src/panel-plan.ts`, `web/src/components/PanelSummary.tsx`, `tests/panel-plan.test.ts`.  
Değişen: `web/src/App.tsx`, `web/src/components/ContextBlock.tsx`, `web/src/components/PlannedModule.tsx`, `web/src/screens/Dashboard.tsx`, `web/src/screens/Disk.tsx`, `web/src/screens/Projects.tsx`, `web/src/screens/Tools.tsx`, `web/src/i18n.ts`, `web/src/styles.css`.

## 10. Notlar

- `rightPanel.stat.planned` anahtarı `rightPanel.stat.selected` olarak yeniden adlandırıldı (Disk özetindeki değer seçili kümelerin toplamı; "Planda" yanıltıcıydı).
- `context.meta` anahtarı "Sunucu" başlığı olarak kullanıldı.
- Kabuk sınırı testi (`tests/shell-boundary.test.ts`) korunur: `web/src` yalnızca `contract.ts` ve `approval.ts` import eder.
