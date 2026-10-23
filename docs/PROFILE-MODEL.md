# Kullanıcı profili modeli (T74)

> **Durum:** kanonik tanım · 23.10.2026
> **Karar kaynağı:** `docs/HANDOVER-2026-10-23.md` §8,
> `docs/HANDOVER-2026-10-23c.md` W1, `state.json` T74.
> **Uygulama:** web fazı W1 (T74). Karar motoru değişmez.

---

## 0. Tek cümle

Üç kullanıcı profili bir **kişi / niyet** tanımıdır; **hız, derinlik, zorluk
veya agresiflik ayarı değildir**.

> **"Hızlı temizlik" ve "derin temizlik" diye bir mod yoktur ve
> eklenmeyecektir.** Eski `docs/T44-PLAN.md` tablosundaki "ayda bir derin
> temizlik" ifadesi kullanım **sıklığını** anlatır; bir uygulama modu veya
> zorluk seviyesi değildir. Temizliğin kapsamı **kanıt + risk + kullanıcı
> seçimi** ile belirlenir. Profil bu kapsamı genişletmez veya daraltmaz.

---

## 1. "Profil" sözcüğünün üç ayrı ekseni

Proje katmanında bugün "profil" adını taşıyan üç ayrı kavram vardır. Bunlar
birbirine bağlanamaz ve birbirinin yerine kullanılamaz.

| Eksen | Kimlikler | Nerede | Neyi değiştirir | Neyi **değiştirmez** |
|---|---|---|---|---|
| **Kullanıcı profili** (persona) | `developer` · `vibe` · `hybrid` | Web sunumu + `store/settings.ts` (`uiProfile`) | Açılış ekranı, kart/sıra, yoğunluk, metin tonu, sağ panel varsayılanı | Tarama kapsamı, risk, hedef, seçim, onay ifadesi |
| **Tarama kapsamı** | `lean` · `audit` · `full` | `src/core/discover.ts` → `BUILTIN_PROFILES`; CLI `--profile` | Hangi ortamların taranacağı; `audit` salt okunur | Kullanıcı profili; onay kuralları; `report-only` |
| **Graf bakış profili** | `protect` · `experiment` | `web/src/screens/Graph.tsx` | Açılan satırda **bölüm sırası** (ilişkiler ↔ etki) | Veri, düğüm/kenar, karar, plan |

**Kural:** Üç eksen aynı `profile` sözcüğünü paylaşsa da veri akışında
birleşmez. Özellikle persona, tarama kapsamına **parametre olarak geçmez**.

---

## 2. Üç kullanıcı profili

| | **1. Developer** (`developer`) | **2. Vibe coder** (`vibe`) | **3. Melez / araştırmacı** (`hybrid`, varsayılan) |
|---|---|---|---|
| **Kim** | Projeye hâkim; kodu/emeği korunmalı; AI kalıntılarıyla uğraşmak istemiyor | Sürekli CLI aracı indirip deniyor; hızlı ve sade sonuç istiyor | Hem proje geliştiriyor hem araçları/kanıtları inceliyor |
| **Önceliği** | Proje güvenliği, Git farkındalığı, gürültüsüz liste | "Ne var / ne silinebilir" özeti, adım adım akış | Filtre + kanıt + deney alanı |
| **Açılış ekranı** | Projeler + kanıt; yalnız "güvenli kazanım" | Genel Bakış: sayı + tek cümle sonuç | Disk/Genel Bakış + sağ panel kanıt |
| **AI/ajan artıkları** | Ayrı ve işaretli; varsayılan seçimde yok | Sade dille "ne olduğu" açıklanır | Kanıt ağacında ayrıntılı |
| **Başarı anı** | "12 projede 3.2 GB; hepsi geri gelir; 0 tracked hedef" | "6 atıl aracı kanalıyla kaldırdım; 4 gölge gitti" | "Kanıt zincirini gördüm, what-if ile engeli doğruladım" |
| **Başarısızlık** | Tek yanlış silme | Uzun onay zinciri → vazgeçer | Kanıtsız/hesapsız ekran |
| **Asla yapmamalı** | Persona adına geniş hedef seçmek | Riski "gelişmiş" arkasına saklamak | Profili güvenlik kapısı sanmak |

**Varsayılan:** `hybrid`. Gerekçe: yanlış varsayılan veri kaybettirmez;
dar görünüm kullanıcıyı yanlış yönlendirmez.

---

## 3. Profilin değiştirebilecekleri (izinli liste)

- Açılış ekranı ve ekran/kart **sırası**
- Sağ panelde varsayılan modül ve katlanma durumu
- Bilgi yoğunluğu: sade özet → orta → kanıt düzeyi
- Aynı gerçeğin **metin tonu** (TR/EN sözlüğünde ayrı anahtar)
- Onboarding adım sayısı ve örnekleri
- Motorun desteklediği değerlerden **filtre ön ayarı** (hesap motorda)

## 4. Profilin değiştiremeyecekleri (yasak liste)

- Tarama kapsamı, ortam listesi, `minAge`, `readOnly`
- Risk sınıfı, `report-only`, silme hedefi üretimi
- Varsayılan seçim (`DefaultSelection`) ve plan kapsamı
- İki aşamalı onay, yazılı ifade (`TASI` / `SIL` / `TEMIZLE` …), kasa/purge
- `guard.ts` ve korumalı yollar
- Aynı veride farklı sayı, toplam veya hedef
- Profil değişiminde yeniden tarama veya planın değişmesi

> İhlal denetimi: `web/src` persona dışında karar üretemez (kural 18);
> `src/core` içinde persona koşulu bulunamaz. Persona yalnız sunum
> haritasıdır.

---

## 5. Kalıcılık ve veri akışı

```ts
type UserProfile = 'developer' | 'vibe' | 'hybrid'; // varsayılan: hybrid
```

- **Depolama:** `src/store/settings.ts` → `WebSettings.uiProfile`.
  Geçersiz/eksik değer `hybrid`'e düşer; varsayılan `hybrid`.
- **Sözleşme:** `contract.ts` → `SettingsResponse` / `SettingsUpdateRequest`
  alanı. Yalnız kimlik taşır; etiketler TR/EN sözlüğünde üretilir.
- **API:** `GET/PUT /api/settings`. Persona **hiçbir** tarama, plan, silme
  veya envanter ucuna parametre olarak gönderilmez.
- **Web:** `web/src/profiles.ts` → statik sunum haritası
  (`initialScreen`, `screenOrder`, `panelDefault`, `density`, `copyKey`).
  Veri filtremez; yalnız hangi görünümün önce gösterileceğini seçer.
- **Değişim:** yalnız `PUT /api/settings` + yerel görünüm. Tarama tetiklemez;
  açık planı, seçimi veya kasa durumunu değiştirmez.

---

## 6. Onboarding ve adlandırma

- İlk açılışta üç persona kartı: **"Ne yapıyorsun?"** sorusu.
  "Zorluk seç", "hızlı/derin", "agresif temizlik" ifadeleri **yasak**.
- Varsayılan `hybrid` işaretli; "Şimdilik melez" ile atlanabilir.
- Değişiklik her zaman **Ayarlar → Kullanıcı profili**.
- **Adlandırma temizliği (W0/W1):**
  - `disk.filter.profile` etiketi "Ortam profili" → **"Tarama kapsamı"**
    (EN: "Scan scope"). Böylece persona ile karışmaz.
  - CLI `--profile` yardım metni "kayıtlı tarama kapsamı" der.
  - `graph.profile` etiketi "Bakış profili" olarak kalır.

---

## 7. Kabul testleri (T74 için bağlayıcı)

1. Persona değişimi `/api/disk` yanıtındaki **sayı, karar, hedef ve seçimi**
   değiştirmez; yalnız sunum alanları değişir.
2. Plan içeriği ve onay ifadesi üç profilde **aynıdır**.
3. `report-only`, `guard` ve iki aşamalı onay testleri üç profilde de geçer.
4. Varsayılan `hybrid`; geçersiz değer `hybrid`'e düşer; yeniden başlatmada
   korunur.
5. Profil değişimi **tarama başlatmaz** (`/api/scan` çağrısı yok).
6. Onboarding atlanabilir; TR/EN, klavye-only ve ekran okuyucu üç profilde
   zorunlu; `prefers-reduced-motion` korunur.
7. Persona kimlikleri `src/core` kararlarında geçmez; yalnız
   `contract.ts` tipi ve `store/settings.ts` kalıcılığında bulunur.
