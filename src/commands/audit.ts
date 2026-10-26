import { AuditService } from '../services/audit-service.ts';
import type { AuditEventView, AuditResponse } from '../core/contract.ts';
import { formatBytes, formatDateTime } from '../util/format.ts';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

function kindLabel(k: AuditEventView['kind']): string {
  switch (k) {
    case 'delete':
      return 'silme';
    case 'restore':
      return 'geri yukleme';
    case 'purge':
      return 'kalici silme';
    default:
      return 'diger';
  }
}

function usage(): void {
  console.log(
    'Kullanim: residue audit [--since 24h|7d|30d] [--kind delete|restore|purge|all] [--limit 50] [--json]',
  );
}

export async function runAudit(args: string[]): Promise<void> {
  let since: string | undefined;
  let kind = 'all';
  let limit = 100;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--json') {
      json = true;
    } else if (a === '--since') {
      since = args[++i] as string;
    } else if (a.startsWith('--since=')) {
      since = a.split('=')[1] as string;
    } else if (a === '--kind') {
      kind = (args[++i] as string) ?? 'all';
    } else if (a.startsWith('--kind=')) {
      kind = a.split('=')[1] as string;
    } else if (a === '--limit') {
      limit = Number(args[++i]);
    } else if (a.startsWith('--limit=')) {
      limit = Number(a.split('=')[1]);
    } else if (a === '-h' || a === '--help') {
      usage();
      return;
    } else {
      usage();
      process.exitCode = 1;
      return;
    }
  }

  if (!Number.isFinite(limit) || limit < 1) limit = 100;

  const svc = new AuditService();
  let data: AuditResponse;
  try {
    data = await svc.list({ since, kind, limit });
  } catch (err) {
    console.error(`${C.red}Hata:${C.reset} ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const shownCount = data.events.length;
  const totalCount = data.counts.total;
  const filtered = shownCount !== totalCount;
  const headerCount = filtered ? `${shownCount} / ${totalCount} olay` : `${totalCount} olay`;
  console.log(`\n${C.bold}Residue - denetim gecmisi${C.reset} ${C.gray}(${headerCount})${C.reset}`);
  console.log(
    `${C.gray}${filtered ? 'dosyada: ' : ''}silme: ${data.counts.delete}  geri yukleme: ${data.counts.restore}  kalici: ${data.counts.purge}  basarisiz: ${data.counts.failed}${C.reset}\n`,
  );

  if (data.events.length === 0) {
    console.log(`${C.gray}Kayit yok.${C.reset}\n`);
    return;
  }

  for (const e of data.events) {
    const date = formatDateTime(e.at);
    const status = e.ok
      ? `${C.green}basarili${C.reset}`
      : `${C.red}basarisiz${C.reset}${e.code ? ` (${e.code})` : ''}${e.reason ? ` - ${e.reason}` : ''}`;
    const pathPart = e.path ? ` ${C.cyan}${e.path}${C.reset}` : '';
    const bytesPart = typeof e.bytes === 'number' ? ` ${C.gray}· ${formatBytes(e.bytes)}${C.reset}` : '';
    console.log(`${C.gray}${date}${C.reset} · ${kindLabel(e.kind)} · ${status}${bytesPart}${pathPart}`);
    if (e.paths && e.paths.length > 0) {
      const shown = e.paths.slice(0, 3).join(', ');
      const extra = e.paths.length > 3 ? ` +${e.paths.length - 3}` : '';
      console.log(`    ${C.dim}${shown}${extra}${C.reset}`);
    }
  }
  console.log('');
}
