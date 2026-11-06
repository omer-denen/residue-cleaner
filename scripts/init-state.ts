/**
 * state.json uretir: projenin bugunku gercek durumu.
 * Bu dosya elle duzenlenebilir; residue status ile okunur.
 */
import { writeState, type ProjectState } from '../src/util/state.ts';

const now = new Date().toISOString();

const s: ProjectState = {
  version: 1,
  updatedAt: now,
  project: {
    name: 'Residue',
    purpose: 'Disk artiklarini kanitlarla listeleyen, secimini kullaniciya onaylatan temizleyici',
    stack: 'TypeScript + Node 24 + Ink 8 / React 19 (tsx runner; Bun kurulu degil)',
    entry: 'src/cli.ts',
  },
  commands: [
    { cmd: 'node bin/residue.mjs scan', desc: 'Tara ve listele (gruplu rapor)' },
    { cmd: 'node bin/residue.mjs ui', desc: 'Terminal TUI — Ink, TTY gerektirir' },
    { cmd: 'node bin/residue.mjs clean', desc: 'Iki asamali onay + geri donusum kutusu' },
    { cmd: 'node bin/residue.mjs clean --only <ad>', desc: 'Tek kumu temizle' },
    { cmd: 'node bin/residue.mjs vault purge --id <kasa-id>', desc: 'Kasa ogesini kalici sil (yazili onay)' },
    { cmd: 'node bin/residue.mjs explain <ad>', desc: 'Karar gerekcesini kanitlarla goster' },
    { cmd: 'node bin/residue.mjs log --summary', desc: 'Son 1 saat: siniflandirma/uyari/hata' },
    { cmd: 'node bin/residue.mjs doctor', desc: 'Ortam kontrolu (uzun yol, geri donusum, GPU)' },
    { cmd: 'node bin/residue.mjs undo --restore', desc: 'Geri donusum kutusundan geri al' },
    { cmd: 'node bin/residue.mjs rules', desc: 'Kural listesi (kanit -> karar)' },
  ],

  tasks: [
    {
      id: 'T1',
      title: 'Paralel dosya sistemi yuruyucusu (uzun yol destekli)',
      status: 'done',
      note: 'opendir + akis; \\\\?\\ on eki; junction dongu korumasi',
      updatedAt: now,
    },
    {
      id: 'T2',
      title: 'Kanit toplayici (dosya turu, dizin yapisi, log sinyalleri)',
      status: 'done',
      note: 'Kaynak kodda HICBIR uygulama adi yok; sadece tur isaretleri',
      updatedAt: now,
    },
    {
      id: 'T3',
      title: 'Kanit -> mimari tip -> karar zinciri',
      status: 'done',
      note: 'Bilesik degerlendirme: model deposu icindeki olu GPU runtime ayri hedef',
      updatedAt: now,
    },
    {
      id: 'T4',
      title: 'Uygulama bazli kume + ortam profilleri',
      status: 'done',
      note: 'Local ve Roaming AYRI kume (bkz. B8)',
      updatedAt: now,
    },
    {
      id: 'T5',
      title: 'Iki asamali onay + geri donusum kutusu',
      status: 'done',
      note: 'Dusuk: evet | Orta/Yuksek: kasa icin TASI, kalici silme icin SIL yazmali | --yes orta riski bypass EDEMEZ',
      updatedAt: now,
    },
    {
      id: 'T6',
      title: 'Gunluk sistemi (karar gerekceleri + hatalar)',
      status: 'done',
      note: 'residue log --summary',
      updatedAt: now,
    },
    {
      id: 'T7',
      title: 'Terminal TUI (Ink + React)',
      status: 'done',
      note: 'Tarama -> gozden gecirme -> onay -> silme -> ozet. Ink TTY gerektirir, pipe uzerinden calismaz.',
      updatedAt: now,
    },
    {
      id: 'T8',
      title: '.nuget paket deposunun dogru taninmasi',
      status: 'wip',
      note: 'Icerisinde CACHEDIR.TAG YOK. *.nupkg dosyalariyla taninmali. Simdilik "kanit yetersiz" diyor.',
      next: 'detectArchetype icinde: kokte veya ilk N cocuk paket klasorunde .nupkg/.nuspec/.sha512 arama ekle',
      updatedAt: now,
    },
    {
      id: 'T9',
      title: 'TUI geri donusum kutusu toplu silme yolunu kullaniyor mu?',
      status: 'todo',
      note: 'TUI, deleteTarget uzerinden gidiyor ama journal yazimi TUI icinde eklendi, test edilmedi',
      next: 'TUI ile kucuk bir hedef (orn. updater klasoru) sil, gunluk dosyasinin yazildigini dogrula',
      updatedAt: now,
    },
    {
      id: 'T10',
      title: 'Proje ici artiklar (node_modules, .venv, dist)',
      status: 'todo',
      note: 'Kapsam disi birakildi; ayri kok gerektiriyor ve riskli',
      next: '--root secenegi ekle, varsayilan report-only',
      updatedAt: now,
    },
  ],

  bugs: [
    {
      title: 'Her .dll dosyasi "cuda-runtime" sayiliyordu',
      symptom: 'Mullvad (VPN, 260 MB), Local\\Programs (1.5 GB) ve .tlauncher "GPU hizlandirici runtime" olarak onerildi ve SILME HEDEFI aldi. Programs silinseydi tum kurulu uygulamalar giderdi.',
      cause: "kindOfFile() icinde 'dll' uzantisi dogrudan 'cuda-runtime' donuyordu; hicbir CUDA kontrolu yoktu.",
      fix: "Yeni tip eklendi: 'native-lib'. cuda-runtime yalnizca CUDA_DLL_RE/ORT_DLL_RE ile ESLESEN dosyalara verilir. Local\\Programs gibi kokler PROTECTED_ROOTS ve NEVER_PROBE ile onklemeden cikarildi.",
      status: 'fixed',
      severity: 'critical',
    },
    {
      title: 'Dosya basina PowerShell sureci: 117.000 kez baslatma',
      symptom: "runt-nightly temizleme islemi saatlerce surdu, takildi, 4 orphan powershell.exe birakti. Kullanici 'dongude mi kaldin' diye sordu.",
      cause: 'recycleViaShell() her dosya icin ayrica execFile("powershell.exe") cagriyordu. runt-nightly 116.956 dosya iceriyor.',
      fix: 'RecycleBin sinifi: TEK kalici PowerShell oturumu, dosyalar stdin uzerinden akitilir. 4.2 ms/dosya (saniyede ~240 dosya). recycleBinHasRoom da 5 dk onbellekli.',
      status: 'fixed',
      severity: 'critical',
    },
    {
      title: 'PowerShell protokolu: __PING__ donguyu kapatiyordu',
      symptom: '500 dosya testinin tamami "zaman asimi" ile basarisiz oldu; hicbir cevap gelmedi.',
      cause: "Hazirlik dogrulama komutu '__PING__', PowerShell betigindeki '__QUIT__' kontrolune takiliyor ve donguyu bitiriyordu.",
      fix: "Betikte '__PING__' icin 'continue' eklendi. READY sinyali ayri bir Write-Output ile gelir.",
      status: 'fixed',
      severity: 'high',
    },
    {
      title: 'uninstall.exe "installer" sayiliyordu',
      symptom: 'Mullvad (VPN uygulamasi) "guncelleyici artigi" olarak onerildi, silme hedefi aldi.',
      cause: 'kindOfFile regex\'i /install/ ile eslesiyordu; uninstall.exe de iceriyor.',
      fix: '/uninstall|unins\\d/ once elenir ve null doner (artik degil, cikarici). /postupdate|updater/ ayri ele alindi.',
      status: 'fixed',
      severity: 'high',
    },
    {
      title: 'Local\\uv ve Roaming\\uv ayni kume sayiliyordu',
      symptom: 'uv 2.4 GB "yuksek risk" gorunuyordu; oysa Local\\uv bir paket ONBELLEGI (guvenli).',
      cause: 'clusterKey yalnizca isimden uretiliyordu. Roaming\\uv kurulu Python surumlerinin kendisi (runtime-pool) ve yüksek riski Local tarafina tasidi.',
      fix: 'clusterKey artik kok kapsamini (local/roaming/home) one ekliyor. Ayni isim, farkli kok = farkli kume.',
      status: 'fixed',
      severity: 'high',
    },
    {
      title: 'Risk birleştirmede en yüksek risk kazanıyordu',
      symptom: '15 GB npm-cache "dogrulama" (medium) olarak cikti, "onerilen" degil.',
      cause: 'mergeVerdict en yuksek riski seciyordu; kume icindeki tek bir "tanimlanamayan" parc tum kumeyi kirletiyordu.',
      fix: 'SAFEST_ARCHETYPES: guvenli turlere (paket onbellegi, guncelleyici, gecici, crash, electron) oncelik verilir.',
      status: 'fixed',
      severity: 'high',
    },
    {
      title: 'Log sinyallerinde break ile kanit kaybi',
      symptom: 'MuhasibPro icin "Device: CPU" kaniti bulunamadi; 3.5 GB gereksiz GPU runtime guvenli sayilmadi.',
      cause: 'LOG_MARKERS dongusunde ilk eslesmede break ediliyordu. Satir "Device: CPU,EPs: CPUExecutionProvider" idi ve once "ONNX Runtime" isaretine takiliyordu.',
      fix: 'break kaldirildi: bir satir birden fazla isaret tasiyabilir.',
      status: 'fixed',
      severity: 'high',
    },
    {
      title: 'webgpu-ep yanlis silme hedefiydi',
      symptom: '27 MB webgpu-ep "GPU icin derlenmis" olarak isaretlendi.',
      cause: 'Yol adi gpu iceriyor diye model varyanti sayiliyordu. Ama webgpu-ep bir CALISTIRMA SAGLAYICISI; CPU\'da da calisir.',
      fix: 'looksLikeModelDir(): icerik kontrolu — model.onnx / tokenizer.json / genai_config.json yoksa model degildir, dokunulmaz.',
      status: 'fixed',
      severity: 'medium',
    },
    {
      title: 'GPU varyanti sayimi yanlitti',
      symptom: '"9 GPU varyantli model bulundu" yaziyordu, gercekte 1.',
      cause: 'Sayim maxLarge:12 ile kirpilmis buyuk dosya listesinden geliyordu.',
      fix: 'Sayim olculmus alt parcalardan (sub.length) aliniyor.',
      status: 'fixed',
      severity: 'medium',
    },
    {
      title: 'Onerilen ama silme hedefi olmayan kume',
      symptom: '.copilot "safe" gorunuyordu ama silinecek yol yoktu; kullanici "sil" dese hicbir sey olmazdi.',
      cause: 'karar katmani ile hedef uretimi birbirinden bagimsizdi.',
      fix: 'Tutarlilik kurali eklendi: hedef yoksa karar "ask"a iner ve gerekceye not düşülür.',
      status: 'fixed',
      severity: 'medium',
    },
    {
      title: 'doctor: geri donusum kutusu testi gecersiz API kullaniyordu',
      symptom: 'Doktor her zaman "uyari" veriyordu, geri donusum kutusu calisiyor olmasina ragmen.',
      cause: 'GetSpecialFolderOption() hatali bir cagri; PowerShell hata firlatiyor.',
      fix: 'Gercek bir dosya olusturulup DeleteFile("SendToRecycleBin") ile test ediliyor. Artik "calisiyor" diyor.',
      status: 'fixed',
      severity: 'low',
    },
    {
      title: 'doctor: guncelleyici klasoru 0 MB raporlandi',
      symptom: 'Uc updater klasoru toplam 0 MB gorunuyordu.',
      cause: 'Dizin stat.size dizin kaydi icindir; icerik olculuyordu.',
      fix: 'walk() ile gercek icerik olculuyor. Artik 528 MB.',
      status: 'fixed',
      severity: 'low',
    },
    {
      title: 'collectFiles 200k siniri: yarim silme riski',
      symptom: 'Sinir asilirsa dosyalarin bir kismi silinir, kullaniciya yanlis "tamamlandi" bilgisi verilir.',
      cause: 'max = 200_000 sabit.',
      fix: 'Sinir kaldirildi. (B2 duzeltmesiyle dolayli olarak cozuldu: artik dosya basina surec acilmadigi icin liste tekil bellege alinmiyor.)',
      status: 'fixed',
      severity: 'medium',
    },
  ],

  perf: [
    { what: 'Tam tarama (89 GB, 124 kok)', value: '11.8 saniye' },
    { what: 'Nokta klasorleri taramasi (23.4 GB, 26 kok)', value: '4.1 saniye' },
    { what: 'Geri donusum kutusu — dosya basina', value: '4.2 ms (~240 dosya/saniye)' },
    { what: 'Oncesi (dosya basina surec)', value: '~135 ms ve pratikte calismiyordu' },
    { what: 'Geri donusum kutusu kota sorgusu', value: '1.1 saniye (5 dk onbellekli)' },
    { what: 'runt-nightly dosya sayisi', value: '116.956 dosya / 6.0 GB' },
    { what: 'Uzun yol testi (doctor)', value: '353 karakter — gecdi' },
  ],

  actionsPerformed: [
    'CrashDumps 39.6 MB silindi (geri donusum kutusunda, geri alinabilir)',
    'Temp yasli dosyalari silindi — 1.65 GB kalici (3+ gun eski filtrelemesi ile)',
    '@opencode-aidesktop-updater 241 MB silindi, sonra undo --restore ile GERI ALINDI (dogrulama amaciyla)',
    'Disk boslugu 95.2 GB -> 98.1 GB arasinda degisti',
    'Takilan 4 orphan powershell sureci sonlandirildi (MCP Process kill ile)',
    'BULGU: .MuhasibPro 7.10 GB icinden yalnizca 3.45 GB silinebilir. Log "Device: CPU" diyor, 2.26 GB CUDA runtime + 1.19 GB trtrtx-gpu modeli kullanilamiyor. CPU modelleri korunuyor.',
    'BULGU: runt-nightly 4 ortam, IKISER KEZ TEKRAR. conda ve pixi ayni python.exe (SHA 8393ADCE), iki uv ortami da ayni (SHA D86FA6DB). conda-meta/history 0 byte.',
  ],

  openQuestions: [
    'runt-nightly ortamlarini silmek guvenli mi? Hangi projeler bunlara bagli bilinmiyor. Onay ekraninda "90+ gun eski" filtresi var ama ortamlar 12 gun once kullanilmis — yani hicbiri hedeflenmiyor mu?',
    'hermes (3.3 GB) ne iceriyor? sessions/, skills/, memories/ var ama ajan verisi olarak korunuyor. Kullanilabilir mi?',
    'Proje ici artiklar (node_modules/.venv) kapsama alinacak mi? Ayri --root secenegi gerekir.',
  ],
};

await writeState(s, process.cwd());
console.log(`state.json yazildi: ${s.tasks.length} gorev, ${s.bugs.length} hata, ${s.perf.length} olcum`);