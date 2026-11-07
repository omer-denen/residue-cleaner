# Devir — 2026-11-07 (b) — Beta kapanışı

> **Ara taslak.** Aynı oturumun nihai devir kaydı
> [`docs/HANDOVER-2026-11-08.md`](./HANDOVER-2026-11-08.md) — yayın
> (`0.3.0-beta.1`), kabul matrisi (86 ✅ · 5 🟡) ve kararlı sürüm kararı
> orada. Çelişkide o belge geçerlidir.

## Kapsam

Bu oturumda backlog sıfırlandı ve beta kapısı kapatıldı:

| Görev | Konu | Kanıt |
|---|---|---|
| **B18** | `state.json` yazım koruması | `StateScaffold` + `writeStateSafely`; 12 test; gerçek `npm run init-state` artık yazmıyor |
| **B20** | İptal edilen tarama geçmişte "tamamlanmadı" | `outcome`/`progress`/`rows`; 13 test; tarayıcıda rozet |
| **B14** | Kanıt toplamada gereksiz syscall | `probeDir` tek `readdir`; 10 test; A/B 310→245 ms |
| **B13** | Graf: disk kümeleri + proje yapıtları | `disk-cluster`, `project-artifact`, `owner`; 12 test; 271 düğüm |
| **B15** | Yüksek riskli kümede **ad yazma** onayı | `HighRiskOverride`; 12 test; TR/EN tarayıcı |
| **B16** | Planlı çalışmalarda PATH temizliği | `mode: 'env'` + `envApprovedAt` + yedek + `env.scheduled`; 13 test |
| **B17** | Eski ad kalıntıları | denetim + `legacy-name-removed` kapısı; 2 test |
| **E2E** | Otomatik tarayıcı kapısı | 12 senaryo, **123/123 kontrol** |

Sürüm: **`0.3.0-beta.1`** (`latest` kararlı sürümde kalır).
Yayın (07.11.2026): `npm publish --tag beta` → `{ latest: '2.2.0', beta: '0.3.0-beta.1' }`;
paket 143 dosya / 509.5 kB; shasum `8a6d8fb99b37aa419dfddfc9d67658a492ea7f9f`;
tag `v0.3.0-beta.1` GitHub'a gönderildi.
Test: **824/824** · typecheck temiz · `build:web` temiz · `smoke` +
`smoke:package` temiz · `npm run e2e` temiz (iki ardışık koşu).

## 1. E2E kapısı (yeni)

- `playwright-core@1.65.0` (devDependency, tarayıcı indirmez) + kurulu Edge
  (`channel: 'msedge'`, yoksa Chrome).
- `e2e/harness.mjs`: senaryo başına geçici veri dizini (`LOCALAPPDATA`,
  `APPDATA`, `USERPROFILE` oraya yönlenir), rastgele port, sahte disk
  fixture'ı ve `backdate` (40 gün), onboarding kapatma, konsol/400+ toplama.
- `e2e/scenarios/`: WEB-02, 03, 04, 05, 06, 07, 08, 10, 11, 13, 14, 16.
- Kanca: `web/src/App.tsx` rail düğmelerine ve `<main>`e `data-screen`
  (yalnız test seçicisi; davranış değişmedi).
- Komut: `npm run e2e` (isteğe bağlı filtre: `npm run e2e -- 02`).
- Ayrıntı ve bilinen sınırlar: `docs/E2E.md`.
- Zaman duyarlı kontroller için tek seferlik yeniden deneme eklendi
  (`(yeniden)` etiketiyle görünür).

Bilinen sınırlar (dürüst kayıt):

- WEB-07 "engellenen" örneği sandbox'ta üretilemez (aynı grup muafiyeti);
  bu yol birim testleriyle doğrulanır.
- WEB-05/WEB-06 gerçek kaldırma/temizlik **çalıştırmaz**; yalnız plan ve
  onay duvarı sınanır.

## 2. Ekran okuyucu kararı

Kullanıcı kararı (07.11.2026): **NVDA/Narrator ses kanıtı gerekli değil.**
Oturum iptal edildi; profilde ekran okuyucu kurulu değil ve kurulum
istenmiyor. Erişilebilirlik kanıtı: AX ağacı + klavye/odak turu (PROFILE-07)
+ WEB-11 E2E kontrolü (tek `main`/`h1`, adsız düğme yok, canlı bölge,
`role="progressbar"` etiketi).

## 3. Doğrulama kapıları

```bash
npm run typecheck      # temiz
npm test               # 824/824
npm run build:web      # ~557 kB (gzip ~156 kB), >500 kB uyarısı sürüyor
npm run smoke          # SMOKE TEMIZ
npm run smoke:package  # PAKET SMOKE TEMIZ
npm run e2e            # 123/123 kontrol
npm run perf           # B14 sonrası temiz (10k p95 ~3.8 s, 100k ~13.6 s)
```

## 4. Sonraki adımlar

1. **Kararlı sürüm kararı kullanıcıya bırakıldı (07.11.2026): şimdilik beta
   kalır.** Kararlıya çıkılacaksa sürüm numarası (0.3.0 / 1.0.0) ve `latest`
   etiketinin taşınması ayrı bir karar; `latest`'i 0.x'e çekmek 2.2.0
   kullanıcıları için sürüm düşüşü demektir.
2. E2E'yi CI'ya bağlamak (Windows runner + Edge) — isteğe bağlı.
3. Kasa kararı bekleyen kayıt `Local\uv` + `Local\rattler` (kullanıcı silme
   talimatını verdi; kayıtlar 06.11.2026'da silindi — yeniden kontrol et).
