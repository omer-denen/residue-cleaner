import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceReader } from '../src/core/evidence-text.ts';
import type { Cluster } from '../src/core/types.ts';

function cluster(over: Partial<Cluster> = {}): Cluster {
  return {
    key: 'k',
    title: 't',
    archetype: 'unknown',
    parts: [],
    totalBytes: 0,
    reclaimableBytes: 0,
    lastTouched: 0,
    evidence: {},
    verdict: {
      risk: 'safe',
      kind: 'recommend',
      title: '',
      what: '',
      consequence: '',
      because: [],
      preconditions: [],
      regenerability: 'regenerable',
      confidence: 'high',
    },
    ...over,
  };
}

test('ownerLabel her kanit turunu okur', () => {
  assert.equal(EvidenceReader.ownerLabel({ kind: 'packageJson', name: 'pkg', version: '1.2.3' }), 'pkg@1.2.3');
  assert.equal(EvidenceReader.ownerLabel({ kind: 'packageJson', name: 'pkg' }), 'pkg');
  assert.equal(EvidenceReader.ownerLabel({ kind: 'manifest', app: 'app' }), 'app');
  assert.equal(EvidenceReader.ownerLabel({ kind: 'logFile', product: 'prod' }), 'prod');
  assert.equal(EvidenceReader.ownerLabel({ kind: 'binaryProduct', product: 'bin' }), 'bin');
  assert.equal(EvidenceReader.ownerLabel({ kind: 'directoryName', name: 'dir' }), 'dir');
});

test('reading mimari, dosya turu ve isaretleri aciklar', () => {
  const c = cluster({
    archetype: 'pkg-manager-cache',
    evidence: {
      fileKinds: ['onnx-model', 'embedding-index', 'cuda-runtime', 'crash-dump', 'node-modules'],
      markers: ['CACHEDIR.TAG', 'partial-install:abc'],
    },
    verdict: { ...cluster().verdict, risk: 'medium', kind: 'report-only', regenerability: 'user-data' },
    deleteTargets: [
      { path: 'a', kind: 'whole', label: 'a', bytes: 1 },
      { path: 'b', kind: 'older', label: 'b', bytes: 1, minAgeDays: 3 },
    ],
  } as Partial<Cluster>);
  const out = new EvidenceReader(c).reading().join('\n');
  assert.match(out, /Paket yoneticisi onbellegi/);
  assert.match(out, /model agirligi \(onnx\)/);
  assert.match(out, /vektor\/embedding/);
  assert.match(out, /CUDA runtime/);
  assert.match(out, /cokme dumpleri/);
  assert.match(out, /node_modules/);
  assert.match(out, /CACHEDIR\.TAG/);
  assert.match(out, /Yarim kalmis kurulum/);
  assert.match(out, /Kullanici verisi/);
  assert.match(out, /Risk orta/);
  assert.match(out, /Otomatik silinmez/);
  assert.match(out, /1 klasorun tamami ve 1 yasli dosya kumesi/);
});

test('reading git tracked, keep ve yalniz yasli hedefi anlatir', () => {
  const c = cluster({
    evidence: { markers: ['git-tracked'] },
    verdict: { ...cluster().verdict, risk: 'high', kind: 'keep', regenerability: 'unknown' },
    deleteTargets: [{ path: 'b', kind: 'older', label: 'b', bytes: 1, minAgeDays: 3 }],
  });
  const out = new EvidenceReader(c).reading().join('\n');
  assert.match(out, /Sürüm kontrolü altındaki yollar atlandı/);
  assert.match(out, /Yeniden uretilebilirlik belirsiz/);
  assert.match(out, /Risk yuksek/);
  assert.match(out, /Korunuyor/);
  assert.match(out, /1 yasli dosya kumesi/);
});

test('reading kanit yoksa bos kalir, dusuk risk metni eklenir', () => {
  const c = cluster({
    archetype: 'unknown',
    verdict: { ...cluster().verdict, risk: 'low', kind: 'ask' },
  });
  assert.deepEqual(new EvidenceReader(c).reading(), [
    'Kanit yetersiz: yalniz raporlanir.',
    'Yeniden uretilebilir: silinince yeniden kurulur/indirilir.',
    'Risk dusuk.',
  ]);
  assert.equal(EvidenceReader.isGitTracked(cluster()), false);
});

test('reading gunluk sinyalini bildirir', () => {
  const c = cluster({
    archetype: 'unknown',
    evidence: { logSignals: [{ line: 'x', means: 'y' }] },
  });
  assert.match(new EvidenceReader(c).reading().join('\n'), /Gunluk sinyalleri/);
});
