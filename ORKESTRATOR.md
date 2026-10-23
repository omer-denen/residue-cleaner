# ORKESTRATOR.md — orkestratör çalışma protokolü

> Bu dosya **yalnız orkestratör oturumu** içindir. Ürün kodu değildir,
> `src/` altına girmez, npm paketine girmez. Kaynak talimat `AGENTS.md`'dir;
> çelişkide **AGENTS.md kazanır**.

---

## 1. Çalışma alanı

| Ne | Nerede |
|---|---|
| Orkestratör worktree | `C:\Users\Code\.local\share\opencode\worktree\762a0d\orkestrator` |
| Orkestratör dalı | `orkestrator` |
| Entegrasyon hedefi | ana repo `main` (`C:\Users\Code\source\repos\residue-cleaner`) |
| Kalıcı iz | `docs/ORCHESTRATOR-LOG.md` |

`AGENTS.md`, `state.json`, `SESSION_LOG.md` **gitignore'da** olduğu için
worktree'ye checkout ile gelmez; ana repodan elle kopyalanır. Orkestratör
bunlarda değişiklik yaparsa iş sonunda **ana repoya geri kopyalar**.

## 2. Rol dağılımı

- **Orkestratör (bu oturum):** bulguyu kodda doğrular, görev paketini yazar,
  kabul testini tanımlar, subagent çıktısını denetler, kapıları çalıştırır,
  commit atar ve `main`e entegre eder.
- **Uygulayıcı subagent:** tek görev paketi, yalnız beyaz listedeki dosyalar,
  her düzeltme için birim testi yazmak zorunda. Kapsam genişletemez.
- **Denetçi subagent (gerekirse):** bağımsız kod incelemesi; kural ihlali,
  yanlış silme riski, test zayıflatma arar. Kod yazmaz.

Orkestratör **ürün kodunu kendisi yazmaz**; doğrulama için okur, test ve
entegrasyonu yapar. Küçük mekanik düzeltmeler (yazım, tek satır) istisnadır.

### İşçi model (kullanıcı kararı, 22.10.2026 · güncelleme 23.10.2026)

- **Model:** `opencode-go/glm-5.3-flash` (GLM-5.3-Flash)
  — 23.10.2026: Free kotası dolduğu için kullanıcı onayıyla ücretli kanala
  dönüldü; önceki deneme `opencode/glm-5.3-flash-free`.
- **Biçim:** ayrı **görünür PowerShell penceresi**; subagent YOK.
- **Komut:** `opencode run --standalone --auto --model opencode-go/glm-5.3-flash --file <görev>.md "<kısa yönerge>"`
- Görev dosyaları `scratch/gorev-*.md`, penceredeki çıktı `scratch/logs/*.log`
  (ikisi de gitignore'da, ürüne girmez).
- Her görev ayrı `opencode run` sürecidir; bağlamı görev dosyası taşır.
  Orkestratör bitişi log + `git diff` ile doğrular.

## 3. Görev paketi şablonu (subagent'a verilecek)

```md
## Görev: <tek cümle>
### Bağlam
- Kaynak bulgu: <C7 / E10 ...>
- Doğrulanan kod kanıtı: dosya:satır + kısa alıntı
### Dokunulacak dosyalar (beyaz liste)
- src/...
- tests/...
### Yasaklar
- Beyaz liste dışına çıkma; bağımlılık ekleme; mevcut testi silme/zayıflatma
- Uygulama adı yazma (AGENTS.md kural 1)
- PowerShell ile dosya yazma (K13) — edit/write kullan
- report-only / guard / iki aşamalı onayı gevşetme
### Kabul testleri
1. <girdi> → <beklenen>
### Doğrulama
npm run typecheck && npm test   (yeni test sayısını raporla)
### Rapor
Değişen dosya + satır, eklenen test sayısı, typecheck/test sonucu, risk notu
```

## 4. Kapılar (her görev için sırayla)

1. **Baseline:** görev öncesi `npm run typecheck` + `npm test` temiz
   (test sayısı not edilir).
2. **Uygulama:** subagent yalnız beyaz listede çalışır.
3. **Ölçüm:** görev sonrası typecheck + test; test sayısı artmalı.
4. **İnceleme:** `git diff` okunur — kapsam dışı dosya, silinen test,
   gevşeyen güvenlik kapısı, uygulama adı aranır.
5. **Commit:** tek görev = tek commit. Mesaj biçimi:
   `fix: <konu> (analiz P4) - <özet>` veya `test: ...`.
6. **Entegrasyon:** `orkestrator` → `main` merge; ana repoda typecheck + test
   yeniden çalışır. Çakışma varsa önce `main` worktree'ye alınır.

## 5. Paralellik kuralları

- **Aynı dosyaya** iki subagent aynı anda görev almaz.
- Bağımsız dosya kümeleri paralel yürür (ör. `classifier.ts` ≠ `discover.ts`).
- Her subagent kendi test dosyasını yazar; test dosyası paylaşılmaz.
- Paralel görevler bitince orkestratör diff'leri **tek tek** inceler.

## 6. Değişmez yasaklar (AGENTS.md'den)

- Kaynak koda uygulama adı yazmak (kural 1).
- `report-only` kararını gevşetmek, proje/ajan alanına silme hedefi üretmek.
- `src/core/` içine node builtin importu (kural 18).
- `guard.ts` / iki aşamalı onayı / yazılı onay ifadesini kaldırmak.
- Testi silmek veya zayıflatmak; `npm test` sayısını düşürmek.
- PowerShell ile kaynak dosya yazmak (K13).
- `main`e doğrudan commit; `--purge`; gerçek silme denemesi.

## 7. Raporlama

- `docs/ORCHESTRATOR-LOG.md`: her görev paketi → doğrulama kanıtı, subagent
  sonucu, kapı sonuçları, commit, açık risk.
- Kullanıcıya dönüş: **ne bitti / ne açık / sıradaki** — üç başlık, kısa.
- "Yaptım" denip yapılmayan iş yazılmaz (UX-043): belirsizlik önce sorulur.
