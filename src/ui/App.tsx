import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { color, glyph, SECTION } from './theme.ts';
import { Row } from './Row.tsx';
import { formatBytes, padStart, truncatePath } from '../util/format.ts';
import { prettyPath } from '../util/longpath.ts';
import { groupByVerdict } from '../core/merge.ts';
import { DefaultSelection } from '../core/selection.ts';
import { deleteTarget, Journal } from '../actions/delete.ts';
import { dataDir } from '../core/data-dir.ts';
import type { Cluster, ScanResult } from '../core/types.ts';

type Screen = 'scan' | 'review' | 'confirm' | 'execute' | 'done';

interface FlatRow {
  cluster: Cluster;
  selectable: boolean;
  sectionKey: string;
}

/** Kume listesini, secim durumuyla birlikte duz bir diziye acar. */
function useRows(clusters: Cluster[], filter: string): { rows: FlatRow[]; sections: string[] } {
  return useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (c: Cluster) =>
      !f ||
      c.title.toLowerCase().includes(f) ||
      c.key.toLowerCase().includes(f) ||
      c.verdict.what.toLowerCase().includes(f) ||
      c.parts.some((p) => p.path.toLowerCase().includes(f));

    const g = groupByVerdict(clusters);
    const rows: FlatRow[] = [];
    const sections: string[] = [];

    const order = ['recommend', 'ask', 'report-only', 'keep'] as const;
    for (const k of order) {
      const items = g[k].filter(match);
      if (items.length === 0) continue;
      sections.push(k);
      for (const c of items) {
        rows.push({
          cluster: c,
          // Yalnizca gercekten silme hedefi olan kumeler secilebilir
          selectable: c.verdict.kind !== 'report-only' && (c.deleteTargets?.length ?? 0) > 0,
          sectionKey: k,
        });
      }
    }
    return { rows, sections };
  }, [clusters, filter]);
}

export interface AppProps {
  onScan: (onProgress: (done: number, total: number, bytes: number) => void) => Promise<ScanResult>;
}

export const App: React.FC<AppProps> = ({ onScan }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = (stdout as unknown as { columns?: number })?.columns ?? 100;
  const [width, setWidth] = useState(termWidth);

  const [screen, setScreen] = useState<Screen>('scan');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, bytes: 0 });

  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const [execIndex, setExecIndex] = useState(0);
  const [execTotal, setExecTotal] = useState(0);
  const [freed, setFreed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failed, setFailed] = useState(0);
  const [doneRows, setDoneRows] = useState<Array<{ label: string; bytes: number; note: string; ok: boolean }>>([]);

  // --- terminal genisligi ---
  useEffect(() => {
    if (!stdout) return;
    const stream = stdout as unknown as {
      columns?: number;
      on?: (e: string, f: () => void) => void;
      off?: (e: string, f: () => void) => void;
    };
    const onResize = () => setWidth(stream.columns ?? 100);
    stream.on?.('resize', onResize);
    return () => {
      stream.off?.('resize', onResize);
    };
  }, [stdout]);

  // --- tarama ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await onScan((done, total, bytes) => {
        if (alive) setProgress({ done, total, bytes });
      });
      if (!alive) return;
      setResult(r);
      // Varsayilan secim: "onerilen" + hedefi olan + yeniden uretilebilirligi
      // kanitlanmis kumeler (T34). Kullanici verisi/belirsiz varsayilan secilmez.
      const def = new Set<string>();
      for (const c of r.clusters) {
        if (DefaultSelection.selected(c)) def.add(c.key);
      }
      setSelected(def);
      setScreen('review');
    })();
    return () => {
      alive = false;
    };
  }, [onScan]);

  const { rows, sections } = useRows(result?.clusters ?? [], filter);

  const clampCursor = useCallback(() => {
    setCursor((c) => (rows.length === 0 ? 0 : Math.min(c, rows.length - 1)));
  }, [rows.length]);

  useEffect(clampCursor, [filter, result]);

  const move = (d: number) => {
    setCursor((c) => {
      const n = c + d;
      return Math.max(0, Math.min(rows.length - 1, n));
    });
  };

  /** Görünen satırlara göre toplu seçim */
  const selectVisible = (on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (!r.selectable) continue;
        if (on) next.add(r.cluster.key);
        else next.delete(r.cluster.key);
      }
      return next;
    });
  };

  const toggleCurrent = () => {
    const r = rows[cursor];
    if (!r?.selectable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.cluster.key)) next.delete(r.cluster.key);
      else next.add(r.cluster.key);
      return next;
    });
  };

  const selectedClusters = useMemo(
    () => (result?.clusters ?? []).filter((c) => selected.has(c.key)),
    [result, selected],
  );

  const selectedBytes = useMemo(
    () => selectedClusters.reduce((a, c) => a + c.reclaimableBytes, 0),
    [selectedClusters],
  );

  const targetCount = useMemo(
    () => selectedClusters.reduce((a, c) => a + (c.deleteTargets?.length ?? 0), 0),
    [selectedClusters],
  );

  // --- silme ---
  const runDelete = useCallback(async () => {
    setScreen('execute');
    const journal = new Journal();
    const targets = selectedClusters.flatMap((c) =>
      (c.deleteTargets ?? []).map((t) => ({ ...t, cluster: c })),
    );
    setExecTotal(targets.length);

    let freedTotal = 0;
    let skippedTotal = 0;
    let failedTotal = 0;
    const rowsOut: Array<{ label: string; bytes: number; note: string; ok: boolean }> = [];

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      setExecIndex(i);
      const r = await deleteTarget(t, 'recycle');
      freedTotal += r.bytesFreed;
      skippedTotal += r.skipped.length;
      failedTotal += r.failed.length;

      for (const s of r.skipped) {
        journal.add({ at: Date.now(), mode: 'recycle', action: 'skipped', path: s.path, bytes: 0, reason: s.reason });
      }
      for (const f of r.failed) {
        journal.add({ at: Date.now(), mode: 'recycle', action: 'failed', path: f.path, bytes: 0, reason: f.reason });
      }
      journal.add({ at: Date.now(), mode: 'recycle', action: 'deleted', path: t.path, bytes: r.bytesFreed });

      rowsOut.push({
        label: t.label,
        bytes: r.bytesFreed,
        note: r.failed.length > 0 ? `${r.failed.length} hata` : r.skipped.length > 0 ? `${r.skipped.length} atlandi` : 'ok',
        ok: r.failed.length === 0,
      });
    }

    setFreed(freedTotal);
    setSkipped(skippedTotal);
    setFailed(failedTotal);
    setDoneRows(rowsOut);

    // Gunlugu kalici olarak sakla (undo icin)
    if (journal.all().length > 0) {
      try {
        const { mkdir } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { longPath } = await import('../util/longpath.ts');
        const dir = join(dataDir(), 'journals');
        await mkdir(longPath(dir), { recursive: true });
        await journal.save(dir);
      } catch {
        /* gunluk yazilamadi, temizleme zaten tamamlandi */
      }
    }

    setScreen('done');
  }, [selectedClusters]);

  // --- klavye ---
  useInput((input, key) => {
    if (screen === 'scan') {
      if (key.ctrl || input === 'q') exit();
      return;
    }

    if (screen === 'done') {
      if (key.ctrl || input === 'q' || key.return) exit();
      return;
    }

    if (screen === 'execute') {
      if (key.ctrl) exit();
      return;
    }

    if (filtering) {
      if (key.escape) {
        setFiltering(false);
        setFilter('');
      } else if (key.return) {
        setFiltering(false);
      } else if (key.backspace || key.delete) {
        setFilter((f) => f.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setFilter((f) => f + input);
      }
      return;
    }

    if (screen === 'confirm') {
      if (key.escape || input === 'n') setScreen('review');
      else if (input === 'y' || key.return) void runDelete();
      else if (key.ctrl) exit();
      return;
    }

    // review ekrani
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.pageUp) move(-10);
    else if (key.pageDown) move(10);
    else if (key.home) setCursor(0);
    else if (key.end) setCursor(Math.max(0, rows.length - 1));
    else if (input === ' ') toggleCurrent();
    else if (input === 'a') selectVisible(true);
    else if (input === 'n') selectVisible(false);
    else if (input === 'i') {
      const r = rows[cursor];
      if (r) {
        setExpanded((p) => {
          const n = new Set(p);
          if (n.has(r.cluster.key)) n.delete(r.cluster.key);
          else n.add(r.cluster.key);
          return n;
        });
      }
    } else if (input === 'e') {
      setExpanded((p) => (p.size > 0 ? new Set() : new Set((result?.clusters ?? []).map((c) => c.key))));
    } else if (input === '/') setFiltering(true);
    else if (key.escape && filter) setFilter('');
    else if (key.return && selected.size > 0) setScreen('confirm');
    else if (key.ctrl) exit();
    else if (input === '?' || input === 'h') setShowHelp((s) => !s);
    else if (input === 'q') exit();
  });

  // ======================= EKRANLAR =======================

  if (screen === 'scan') {
    const pct = progress.total > 0 ? progress.done / progress.total : 0;
    const barW = Math.max(20, Math.min(60, width - 40));
    const filled = Math.round(pct * barW);
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={color.brightCyan} bold>
          {'  Residue'}
        </Text>
        <Text color={color.gray}> {glyph.dot} Kanit toplaniyor</Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text color={color.cyan}>{'#'.repeat(filled)}</Text>
          <Text color={color.gray}>{'.'.repeat(Math.max(0, barW - filled))}</Text>
        </Box>
        <Box paddingLeft={2} marginTop={1}>
          <Text color={color.gray}>
            {progress.done}/{progress.total} dizin {glyph.dot} {formatBytes(progress.bytes)}
          </Text>
        </Box>
        <Box marginTop={1} paddingLeft={2}>
          <Text color={color.gray}>Ctrl+C ile cik</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'confirm') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={color.bold} color-name={undefined}>
          <Text color={color.bold}>  Silme onayi</Text>
        </Text>
        <Text color={color.gray}>  {selected.size} kume, {targetCount} hedef</Text>
        <Box flexDirection="column" marginTop={1}>
          {selectedClusters.slice(0, 20).map((c) => (
            <Box key={c.key} flexDirection="column" paddingLeft={2}>
              <Text color={color.white}>{glyph.bullet} {truncatePath(c.title, width - 30)}</Text>
              {c.deleteTargets?.map((t, i) => (
                <Text key={i} color={color.gray}>
                  {'  ' + glyph.arrow} {truncatePath(prettyPath(t.path), width - 34)}
                  {t.kind === 'older' ? color.yellow + ` (${t.minAgeDays}+ gun eski)` + color.reset : ''}
                </Text>
              ))}
            </Box>
          ))}
          {selectedClusters.length > 20 && (
            <Box paddingLeft={2}>
              <Text color={color.gray}>
                ... +{selectedClusters.length - 20} kume daha
              </Text>
            </Box>
          )}
        </Box>
        <Box marginTop={1} paddingLeft={2}>
          <Text color={color.bold}>  Toplam: {formatBytes(selectedBytes)}</Text>
          <Text color={color.cyan}>
            {'  (aracin kasasina - geri alinabilir)'}
          </Text>
        </Box>
        <Box marginTop={2} paddingLeft={2}>
          <Text color={color.brightGreen} bold>
            {'  [e]vet  '}
          </Text>
          <Text color={color.gray}>[h]ayir  [Esc] geri  </Text>
          <Text color={color.gray}>Ctrl+C cik</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'execute') {
    const pct = execTotal > 0 ? execIndex / execTotal : 0;
    const barW = Math.max(20, Math.min(50, width - 40));
    const filled = Math.round(pct * barW);
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={color.brightYellow} bold>
          {'  Temizleniyor...'}
        </Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text color={color.yellow}>{'#'.repeat(filled)}</Text>
          <Text color={color.gray}>{'.'.repeat(Math.max(0, barW - filled))}</Text>
        </Box>
        <Box paddingLeft={2} marginTop={1}>
          <Text color={color.gray}>
            {execIndex}/{execTotal} {glyph.dot} {formatBytes(freed)} bosaltildi
          </Text>
        </Box>
        <Box paddingLeft={2} marginTop={1}>
          <Text color={color.gray}>Ctrl+C ile durdur</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'done') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={color.brightGreen} bold>
          {'  Tamamlandi'}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {doneRows.slice(0, 25).map((r, i) => (
            <Text key={i} color={r.ok ? color.gray : color.red}>
              {'  ' + (r.ok ? color.brightGreen + glyph.ok : color.red + glyph.fail)} {color.reset}
              {padStart(formatBytes(r.bytes), 10)} {truncatePath(r.label, Math.max(30, width - 30))}
              {r.note !== 'ok' ? color.yellow + ' ' + r.note + color.reset : ''}
            </Text>
          ))}
          {doneRows.length > 25 && (
            <Text color={color.gray}>{'  ... +' + (doneRows.length - 25) + ' hedef daha'}</Text>
          )}
        </Box>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text color={color.brightGreen} bold>
            {'  Bosaltilan: ' + formatBytes(freed)}
          </Text>
          {skipped > 0 && <Text color={color.gray}>{'  Atlandi   : ' + skipped + ' (kilitli veya cok yeni)'}</Text>}
          {failed > 0 && <Text color={color.red}>{'  Hata      : ' + failed}</Text>}
          <Text color={color.gray}>{'  Gunluk: residue undo'}</Text>
        </Box>
        <Box marginTop={2} paddingLeft={2}>
          <Text color={color.gray}>Cikmak icin </Text>
          <Text color={color.white} bold>
            q
          </Text>
          <Text color={color.gray}> veya Ctrl+C</Text>
        </Box>
      </Box>
    );
  }

  // ======================= REVIEW =======================

  const visibleRows = rows.slice(Math.max(0, cursor - 12), cursor + 12);
  const startIdx = Math.max(0, cursor - 12);
  const s = result?.stats;
  const risky = selectedClusters.filter((c) => c.verdict.risk === 'medium' || c.verdict.risk === 'high');

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Ust bilgi */}
      <Box>
        <Text color={color.bold}>
          {'  Residue  '}
        </Text>
        <Text color={color.gray}>
          {result?.clusters.length ?? 0} kume {glyph.dot} {formatBytes(result?.clusters.reduce((a, c) => a + c.totalBytes, 0) ?? 0)} tarandi
        </Text>
      </Box>

      {filtering ? (
        <Box marginTop={1}>
          <Text color={color.brightCyan}> Filtre: </Text>
          <Text color={color.white}>{filter}</Text>
          <Text color={color.gray}>_</Text>
        </Box>
      ) : filter ? (
        <Box marginTop={1}>
          <Text color={color.gray}> Filtre: </Text>
          <Text color={color.brightCyan}>{filter}</Text>
          <Text color={color.gray}> ({rows.length} eslesme) — Esc temizle</Text>
        </Box>
      ) : null}

      {/* Tablo basligi */}
      <Box marginTop={1}>
        <Text color={color.gray}>
          {'  ' + ' '.repeat(4) + 'BASLIK'.padEnd(Math.max(20, width - 40)) + 'SILINEBILIR'.padStart(11) + 'TOPLAM'.padStart(11) + '  YAS'.padStart(15)}
        </Text>
      </Box>
      <Text color={color.gray}>{'  ' + '-'.repeat(Math.max(60, width - 4))}</Text>

      {/* Satirlar */}
      <Box flexDirection="column">
        {visibleRows.map((r, i) => {
          const idx = startIdx + i;
          const lastOfSection =
            idx === rows.length - 1 || rows[idx + 1]!.sectionKey !== r.sectionKey;
          const firstOfSection =
            idx === 0 || rows[idx - 1]!.sectionKey !== r.sectionKey;
          const sec = SECTION[r.sectionKey as keyof typeof SECTION];
          return (
            <React.Fragment key={r.cluster.key}>
              {firstOfSection && (
                <Text color={sec.color} bold>
                  {'  ' + sec.title}
                </Text>
              )}
              <Row
                cluster={r.cluster}
                selected={selected.has(r.cluster.key)}
                active={idx === cursor}
                expanded={expanded.has(r.cluster.key)}
                width={width}
                selectable={r.selectable}
              />
              {lastOfSection && idx !== rows.length - 1 && <Text> </Text>}
            </React.Fragment>
          );
        })}
      </Box>

      {rows.length === 0 && (
        <Text color={color.gray}> Eslesme yok.</Text>
      )}

      {/* Alt bilgi */}
      <Box marginTop={1} flexDirection="column">
        <Text color={color.gray}>{'  ' + '-'.repeat(Math.max(60, width - 4))}</Text>
        <Box>
          <Text color={color.brightGreen} bold>
            {'  ' + formatBytes(selectedBytes)}
          </Text>
          <Text color={color.gray}>
            {' secili (' + selected.size + ' kume, ' + targetCount + ' hedef)'}
          </Text>
          {risky.length > 0 && (
            <Text color={color.yellow}>{'  ' + glyph.warn + ' ' + risky.length + ' riskli kume secili'}</Text>
          )}
        </Box>
        {s && s.longPathErrors > 0 && (
          <Text color={color.yellow}>{'  ' + glyph.warn + ' ' + s.longPathErrors + ' uzun yol atlandi'}</Text>
        )}
        <Box marginTop={1}>
          <Text color={color.gray}>{'  ↑↓ hareket  '}</Text>
          <Text color={color.gray}>{'←→ sayfa  '}</Text>
          <Text color={color.gray}>[Space] sec  </Text>
          <Text color={color.gray}>a/n tumu  </Text>
          <Text color={color.gray}>i detay  </Text>
          <Text color={color.gray}>/ filtre  </Text>
          <Text color={color.gray}>Enter onayla  </Text>
          <Text color={color.gray}>q cik</Text>
        </Box>
      </Box>

      {showHelp && (
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={color.cyan} paddingX={1}>
          <Text color={color.cyan} bold>
            {' Klavye'}
          </Text>
          <Text color={color.gray}> ↑ / k yukarı · ↓ / j aşağı · PgUp/PgDn sayfa</Text>
          <Text color={color.gray}> Space sec/deselect · a tumu · n hicbiri · i detay · e tum detay</Text>
          <Text color={color.gray}> / filtre ara · Esc filtre temizle · Enter onaya gec</Text>
          <Text color={color.gray}> ? bu yardim · q cik</Text>
          <Text color={color.gray}> Gray satirlar otomatik secilemez (sanal disk, SDK, VPN)</Text>
        </Box>
      )}
    </Box>
  );
};

App.displayName = 'App';