# Arayüz geliştirme — 23.10.2026 (T74 öncesi)

> **Durum:** tasarım kararı + uygulama planı.
> **Kapsam:** kabuk (rail + liste + sağ panel), Disk listesi, sağ panel
> "Planlananlar". Diğer ekranlar ilk turda yalnız yeni kabuk stillerini alır.
> **Değişmez kurallar:** `AGENTS.md` kural 18 (karar motorda), iki aşamalı
> onay, `report-only`, `guard.ts`, localhost + çerez kapıları.

---

## 1. Amaç

Kullanıcı dosya/klasör listesini **tek nefeste** tarayabilmeli; sağ panel
liste üzerinde baskı kurmadan, seçili öğenin kanıtını ve planı göstermeli.

Üç hedef:

1. **Liste alanı büyüsün** — dikey yığın halindeki filtre/aksiyon satırları
   sıkışsın; yalnız liste kaydırılsın (iç içe kaydırma yok).
2. **Sağ panel dinamik olsun** — plana alınan dosya/klasörler orada
   gruplanmış, sayılmış ve tek tek çıkarılabilir görünsün.
3. **Liste planı yansıtsın** — plana giren küme satırında `Planda` rozeti;
   plana ekleme sayfadan ayrılmadan yapılabilsin.

İlham (desen düzeyinde): master-detail / quick-view inspector, yoğun veri
tabloları, dosya yöneticisi yol-öncelikli satırları. Marka kopyalanmaz.

---

## 2. Yerleşim

```
┌──────────────────────────────────────────────────────────────────────┐
│ topbar: marka · tarama durumu · yenile · panel · dil                │
├──────────┬──────────────────────────────────┬───┬────────────────────┤
│ rail     │ main (liste)                     │ ↔ │ inspector           │
│ 208/52px │ başlık + kompakt araç çubuğu     │ 8 │ sekmeler + içerik   │
│          │ sticky sütun başlığı             │   │ sticky özet/alt     │
│          │ yalnız liste kaydırılır          │   │ 300–560px (380)     │
├──────────┴──────────────────────────────────┴───┴────────────────────┤
│ statusbar                                                           │
└──────────────────────────────────────────────────────────────────────┘
```

- Sağ panel **yeniden boyutlandırılabilir**: 8 px ayırıcı, fare + klavye
  (`←`/`→`, `Home`/`End`), çift tık 380 px'e döner.
- Genişlik `localStorage: residue.panelWidth`; 300–560 px sınırı.
- ≤1180 px: panel gizli (mevcut davranış korunur; sonraki turda overlay).
- ≤820 px: rail çekmece (mevcut davranış).

---

## 3. Görsel sistem

Mevcut koyu tema korunur; kontrast ve hiyerarşi sıkılaşır.

| Belirteç | Değer | Kullanım |
|---|---|---|
| `--bg` | `#0a0d12` | sayfa |
| `--panel` | `#10151d` | liste/panel yüzeyi |
| `--panel-2` | `#151c26` | hover / seçili |
| `--line` | `#1d2733` | ayırıcı |
| `--text` | `#e7edf5` | ana metin |
| `--dim` | `#93a1b5` | ikincil |
| `--accent` | `#3fd07a` | güvenli / birincil |
| `--info` | `#5aa9ff` | bilgi |
| `--warn` | `#e3b341` | dikkat |
| `--danger` | `#ff6b6b` | risk |
| `--vault` | `#b392ff` | kasa |

- Gövde 13 px; tablo 12.5 px; üst başlık 20 px; panel başlığı 11 px
  büyük harf + 0.06em.
- Sayılar `font-variant-numeric: tabular-nums`; boyut/süre mono.
- Yarıçap: kontrol 7 px, kart 9 px, rozet 999 px. Gölge yalnız panel ve
  diyalogda.
- Odak: 2 px `--info` halka, 2 px offset. `prefers-reduced-motion` tüm
  geçişleri kapatır.

---

## 4. Disk listesi

- Sayfa başlığı + tarama rozeti + "Yeniden tara" tek satır.
- Kompakt araç çubuğu en fazla 2 satır:
  1. arama (esnek) + durum sekmeleri + "Filtreler" katla/aç
  2. ortam çipleri tek satır yatay kaydırma
- Gelişmiş filtreler (kategori, boyut, yaş, risk, zombi) varsayılan
  **kapalı**; açılınca tek satır.
- Seçim çubuğu liste başlığının hemen üstünde, 36 px; `sticky`.
- Sütun başlığı `sticky top: 0`; yalnız `.cluster-scroll` kaydırılır.
- Satır 40 px (mevcut 46); başlık + yol iki satır; yol `faint`.
- Sütunlar: `24px 10px minmax(0,1fr) 104px 108px 88px 72px 96px`.
- Satır durumları: hover `--panel-2`, seçili `info 8%`, **planda**
  `accent 7%` + sol kenarda 2 px accent çizgi.
- `Planda` rozeti: onay ikonu + metin; `aria-label` ile.
- Seçim çubuğu birincil eylemi **"Plana ekle"**. Tıklayınca:
  mevcut plan anahtarları + seçim birleşir, `POST /api/plan` çağrılır,
  sayfa değişmez, sağ panel `Planlananlar` sekmesine geçer, seçim temizlenir.
- Plan yoksa aynı eylem planı oluşturur; onay adımı Plan ekranında kalır.

---

## 5. Sağ panel — Planlananlar

Üstten alta:

1. **Özet (sticky):** `PLAN` etiketi, toplam boyut (20 px mono), küme ve
   hedef sayısı, TTL sayacı (`09:42`, `aria-live="off"`).
2. **Gruplar:** küme başlığı (risk noktası, başlık, `N hedef · boyut`,
   çıkar düğmesi). Başlık düğmesi grubu açar/kapatır (`aria-expanded`).
3. **Hedef satırları:** dosya/klasör ikonu, yol (tek satır, `title` tam yol),
   etiket (`3 günden eski` / `tümü`), boyut, tek tek çıkar (`×`).
   Yoğunluk: 30–34 px satır; 380 px panelde en az 55 karakter yol görünür.
4. **Alt eylem (sticky):** `Planı aç` birincil; sağda plan kimliği kısa.
5. **Boş durum:** plan ikonu + "Henüz plan yok" + "Listeden seçip
   Plana ekle ile başlayın."

Etkileşim:
- Küme çıkar → `POST /api/plan/remove { planId, key }`.
- Hedef çıkar → `POST /api/plan/remove { planId, targetId }`.
- Yanıt `null` ise plan tamamen boşaldı; liste rozetleri temizlenir.
- Tüm düğmeler `busy` sırasında kapalı; hata `role="alert"`.
- `Planı aç` Plan ekranına gider; onay orada.

---

## 6. Erişilebilirlik

- Ayırıcı: `role="separator"`, `aria-orientation="vertical"`,
  `aria-valuemin/max/now`, klavye ile 16 px adım.
- Plan grubu: `button[aria-expanded]`, hedef çıkar düğmesi
  `aria-label="Plandan çıkar: <yol>"`.
- `Planda` rozeti metin taşır (yalnız renk değil).
- Canlı bölge: seçim özeti ve plan toplamı `aria-live="polite"`.
- Klavye-only tur ve `prefers-reduced-motion` korunur.

---

## 7. Uygulama sırası

1. **Motor/API:** `PlanPanelView`, hedef kimliği, `POST /api/plan/remove`,
   birim + API testleri.
2. **Kabuk:** yeniden boyutlandırılabilir panel, kompakt Disk başlığı,
   kaydırma düzeni, `Planda` rozeti, "Plana ekle".
3. **Plan paneli:** gruplu hedef listesi, çıkarma, TTL, boş durum.
4. **Görsel doğrulama:** headless Edge/CDP (ego-browser bu oturumda
   yükseltilmiş yetki nedeniyle açılamıyor; kullanıcı onayı alındı).
5. Diğer ekranlar: yalnız ortak belirteçler; yapısal değişiklik sonraki tur.
