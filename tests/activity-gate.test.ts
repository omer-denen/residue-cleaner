import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityGate } from '../src/services/activity.ts';
import { ServiceError } from '../src/services/errors.ts';

/**
 * TEK AGIR IS KURALI: disk taramasi ile arac envanteri ayni anda calismaz.
 * Kapi 409 doner; ayni tur is paylasilir; bitis kilidi birakir.
 */

function conflict(fn: () => void): ServiceError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ServiceError, 'ServiceError bekleniyordu');
    return err;
  }
  assert.fail('409 bekleniyordu, hata atilmadi');
}

test('bos kapi: is yok', () => {
  const gate = new ActivityGate();
  assert.equal(gate.busy(), null);
});

test('ayni tur is PAYLASILIR (hata yok)', () => {
  const gate = new ActivityGate();
  gate.begin('scan');
  gate.begin('scan');
  assert.equal(gate.busy(), 'scan');
});

test('disk taramasi surerken envanter 409', () => {
  const gate = new ActivityGate();
  gate.begin('scan');
  const err = conflict(() => gate.begin('inventory'));
  assert.equal(err.status, 409);
  assert.match(err.message, /Disk taramas/);
  assert.equal(gate.busy(), 'scan');
});

test('envanter surerken tarama 409', () => {
  const gate = new ActivityGate();
  gate.begin('inventory');
  const err = conflict(() => gate.begin('scan'));
  assert.equal(err.status, 409);
  assert.match(err.message, /Araç envanteri/);
  assert.equal(gate.busy(), 'inventory');
});

test('biten is kilidi birakir, diger tur baslayabilir', () => {
  const gate = new ActivityGate();
  gate.begin('scan');
  gate.end('scan');
  assert.equal(gate.busy(), null);
  gate.begin('inventory');
  assert.equal(gate.busy(), 'inventory');
});

test('yanlis turun end cagrisi kilidi ACMAZ', () => {
  const gate = new ActivityGate();
  gate.begin('scan');
  gate.end('inventory');
  assert.equal(gate.busy(), 'scan');
});
