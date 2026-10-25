import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProjectAnalysisResponse,
  ProjectCandidateView,
  ProjectListResponse,
  ProjectSort,
  ProjectTab,
} from '../../../src/core/contract.ts';
import { api, ApiError } from '../api.ts';
import { translate, translateUpper, type Lang, type MessageKey } from '../i18n.ts';
import { formatAge, formatBytes } from '../format.ts';
import { RightPanelPortal, useRightPanel } from '../components/RightPanel.tsx';
import { EmptyState } from '../components/EmptyState.tsx';

const TABS: Array<{ id: ProjectTab; label: MessageKey }> = [
  { id: 'all', label: 'projects.tab.all' },
  { id: 'artifacts', label: 'projects.tab.artifacts' },
  { id: 'git', label: 'projects.tab.git' },
  { id: 'agent', label: 'projects.tab.agent' },
];

function parseRoots(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function shortHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 12)}…`;
}

interface Props {
  lang: Lang;
}

/**
 * PROJELER — SALT OKUNUR kesif + artifact/tarif raporu.
 *
 * Arayuz kendi aramasini, filtresini, siralmasini veya toplamini
 * HESAPLAMAZ; her degisiklik `/api/projects/discover` cagirir ve
 * yanittaki `projects`/`counts`/`summary` alanlarini gosterir.
 * Proje kaynagi ASLA hedef degildir; yalniz yeniden uretilebilir
 * klasorler (node_modules, .venv, target...) raporlanir.
 * Silme/plan yurütme yoktur.
 */
export function Projects({ lang }: Props) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

  // Etiket/basliklar: dil bilincli buyuk harf (TR: i -> İ).
  const tu = (key: MessageKey, vars?: Record<string, string | number>) =>
    translateUpper(lang, key, vars);
  const panel = useRightPanel();

  const [rootsInput, setRootsInput] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const forceRefresh = useRef(true);

  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [tab, setTab] = useState<ProjectTab>('all');
  const [sort, setSort] = useState<ProjectSort>('recent');

  const [list, setList] = useState<ProjectListResponse | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysisResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .projectRoots()
      .then((response) => {
        if (!alive) return;
        setRootsInput(response.roots.join('\n'));
        setRoots(response.roots);
        setReady(true);
      })
      .catch((err) => {
        if (!alive) return;
        setListError(err instanceof ApiError ? err.message : String(err));
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedText(text), 300);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (!ready || roots.length === 0) return;
    let alive = true;
    setDiscovering(true);
    setListError(null);
    api
      .discoverProjects({
        roots,
        text: debouncedText,
        tab,
        sort,
        refresh: forceRefresh.current,
      })
      .then((next) => {
        if (alive) setList(next);
      })
      .catch((err) => {
        if (alive) setListError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        forceRefresh.current = false;
        if (alive) setDiscovering(false);
      });
    return () => {
      alive = false;
    };
  }, [ready, roots, debouncedText, tab, sort, refreshTick]);

  useEffect(() => {
    if (!selected) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    let alive = true;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);
    api
      .projectAnalysis(selected)
      .then((next) => {
        if (alive) setAnalysis(next);
      })
      .catch((err) => {
        if (alive) setAnalysisError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setAnalyzing(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const discover = useCallback(() => {
    const parsed = parseRoots(rootsInput);
    setRoots(parsed);
    setSelected(null);
    forceRefresh.current = true;
    setRefreshTick((n) => n + 1);
  }, [rootsInput]);

  const lastActivity = (project: ProjectCandidateView): string =>
    project.lastActivityAt === null
      ? '—'
      : formatAge(Math.max(0, Date.now() - project.lastActivityAt), lang);

  return (
    <div className="projects">
      <section className="projects-main">
        <header className="page-head">
          <div>
            <h1>{t('projects.title')}</h1>
            <p className="dim">{t('projects.subtitle')}</p>
          </div>
          <span className="badge git">{t('projects.reportOnly')}</span>
        </header>

        <div className="project-roots">
          <label className="roots-field">
            <span className="dim">{t('projects.roots')}</span>
            <textarea
              className="control mono"
              rows={2}
              value={rootsInput}
              onChange={(e) => setRootsInput(e.target.value)}
              placeholder={'C:\\projeler\nC:\\kaynak'}
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={discover}
            disabled={discovering || parseRoots(rootsInput).length === 0}
          >
            {discovering ? t('projects.discovering') : t('projects.discover')}
          </button>
        </div>
        <p className="dim hint">{t('projects.rootsHint')}</p>

        {listError && <div className="banner danger" role="alert">{t('projects.error')}: {listError}</div>}

        {list && (
          <>
            <div className="selection-bar" aria-label={t('projects.summary')}>
              <span>
                <strong className="mono">{list.summary.total}</strong> {t('projects.total')}
              </span>
              <span>
                {t('projects.withArtifacts')}:{' '}
                <strong className="mono">{list.summary.withArtifacts}</strong>
              </span>
              <span>
                {t('projects.tab.git')}: <strong className="mono">{list.summary.git}</strong>
              </span>
              <span>
                {t('projects.tab.agent')}:{' '}
                <strong className="mono">{list.summary.agentWorkspace}</strong>
              </span>
              <span className="spacer" />
              {list.truncated && (
                <span className="badge warn">{t('projects.truncated')}</span>
              )}
              {list.skipped > 0 && (
                <span className="dim">
                  {t('projects.skipped')}: {list.skipped}
                </span>
              )}
            </div>

            <div className="filters">
              <input
                className="control search"
                type="search"
                placeholder={t('projects.search')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label={t('projects.search')}
                data-search
              />
              <div className="kind-tabs">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`chip${tab === item.id ? ' active' : ''}`}
                    onClick={() => setTab(item.id)}
                  >
                    {t(item.label)}
                    <span className="chip-count">{list.counts[item.id]}</span>
                  </button>
                ))}
              </div>
              <select
                className="control"
                value={sort}
                onChange={(e) => setSort(e.target.value === 'name' ? 'name' : 'recent')}
                aria-label={t('projects.sort')}
              >
                <option value="recent">{t('projects.sort.recent')}</option>
                <option value="name">{t('projects.sort.name')}</option>
              </select>
            </div>

            {list.projects.length === 0 && !discovering && (
              <EmptyState icon="projects" title={t('projects.empty')} />
            )}

            {list.projects.length > 0 && (
              <div className="project-scroll">
                {list.projects.map((project) => (
                  <button
                    key={project.root}
                    type="button"
                    className={`project-row${selected === project.root ? ' active' : ''}`}
                    onClick={() => {
                      setSelected(project.root);
                      panel?.activate('evidence');
                    }}
                  >
                    <span className="project-name-wrap">
                      <span className="project-name">{project.name}</span>
                      <span className="project-path mono">{project.root}</span>
                    </span>
                    <span className="project-markers">
                      {project.git && <span className="badge git">git</span>}
                      {project.agentWorkspace && (
                        <span className="badge">{t('projects.tab.agent')}</span>
                      )}
                      {project.lockfile && <span className="badge">{project.lockfile}</span>}
                      {project.artifacts.map((artifact) => (
                        <span key={artifact} className="badge">
                          {artifact}
                        </span>
                      ))}
                    </span>
                    <span className="dim num">{lastActivity(project)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <RightPanelPortal when={selected !== null}>
        <aside className="disk-detail projects-detail">
        <h2>{tu('projects.detail')}</h2>

        {selected && analyzing && <p className="dim">{t('projects.loading')}</p>}
        {analysisError && <div className="banner danger" role="alert">{analysisError}</div>}

        {analysis && (
          <>
            <h3>{analysis.name}</h3>
            <p className="mono project-root-path">{analysis.root}</p>
            <div className="detail-badges">
              {analysis.git && <span className="badge git">git</span>}
              {analysis.agentWorkspace && (
                <span className="badge">{t('projects.tab.agent')}</span>
              )}
              {analysis.markers
                .filter((marker) => marker !== 'git')
                .map((marker) => (
                  <span key={marker} className="badge">
                    {marker}
                  </span>
                ))}
            </div>

            <p className="banner success">{t('projects.sourceSafe')}</p>

            <div className="project-stats">
              <div>
                <strong className="mono">{analysis.summary.artifacts}</strong>
                <span className="dim">{t('projects.summary.artifacts')}</span>
              </div>
              <div>
                <strong className="mono">{formatBytes(analysis.summary.totalBytes)}</strong>
                <span className="dim">{t('projects.summary.total')}</span>
              </div>
              <div>
                <strong className="mono">
                  {formatBytes(analysis.summary.realisticBytes)}
                </strong>
                <span className="dim">{t('projects.summary.realistic')}</span>
              </div>
              <div>
                <strong className="mono">{analysis.summary.regenerable}</strong>
                <span className="dim">{t('projects.summary.regenerable')}</span>
              </div>
              <div>
                <strong className="mono">{analysis.summary.tracked}</strong>
                <span className="dim">{t('projects.summary.tracked')}</span>
              </div>
              <div>
                <strong className="mono">{analysis.summary.risks}</strong>
                <span className="dim">{t('projects.summary.risks')}</span>
              </div>
            </div>

            <h4>{tu('projects.plan.title')}</h4>
            <dl className="meta-list">
              <dt>{t('projects.plan.planned')}</dt>
              <dd className="mono">{analysis.plan.planned.length}</dd>
              <dt>{t('projects.plan.blocked')}</dt>
              <dd className="mono">{analysis.plan.blocked.length}</dd>
              <dt>{t('projects.plan.total')}</dt>
              <dd className="mono">{formatBytes(analysis.plan.totalBytes)}</dd>
              <dt>{t('projects.plan.realistic')}</dt>
              <dd className="mono">{formatBytes(analysis.plan.realisticBytes)}</dd>
            </dl>
            {analysis.plan.warnings.length > 0 && (
              <ul className="detail-list">
                {analysis.plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {analysis.plan.blocked.length > 0 && (
              <ul className="detail-list">
                {analysis.plan.blocked.map((blocked) => (
                  <li key={blocked.artifactPath}>
                    <span className="mono">{blocked.artifactPath}</span>
                    <span className="dim">{blocked.reason}</span>
                  </li>
                ))}
              </ul>
            )}

            <h4>{tu('projects.artifacts')}</h4>
            {analysis.artifacts.length === 0 ? (
              <p className="dim">{t('projects.noArtifacts')}</p>
            ) : (
              <ul className="detail-list artifact-list">
                {analysis.artifacts.map((artifact) => (
                  <li key={artifact.artifactPath}>
                    <span className="mono">{artifact.artifactPath}</span>
                    <span className="artifact-meta">
                      <span className="badge">{artifact.ecosystem}</span>
                      {artifact.packageManager && (
                        <span className="badge">{artifact.packageManager}</span>
                      )}
                      {artifact.monorepo && <span className="badge">monorepo</span>}
                      {artifact.patches && (
                        <span className="badge warn">{t('projects.artifact.patches')}</span>
                      )}
                      {artifact.localDeps && (
                        <span className="badge warn">{t('projects.artifact.localDeps')}</span>
                      )}
                      {artifact.artifactTracked && (
                        <span className="badge git">{t('projects.artifact.tracked')}</span>
                      )}
                      <span
                        className={`badge${artifact.regenerable ? ' git' : ' warn'}`}
                      >
                        {artifact.regenerable
                          ? t('projects.artifact.regenerable')
                          : t('projects.artifact.notRegenerable')}
                      </span>
                    </span>
                    <span className="dim">
                      {formatBytes(artifact.bytes)} · {t('projects.artifact.realistic')}{' '}
                      {formatBytes(artifact.realisticBytes)} · {t('projects.artifact.idle')}{' '}
                      {artifact.idleDays}
                    </span>
                    <span className="dim mono">
                      {t('projects.artifact.lockfile')}: {artifact.lockfile ?? '—'} ·{' '}
                      {t('projects.artifact.hash')}: {shortHash(artifact.lockfileHash)}
                    </span>
                    {artifact.installCommand && (
                      <span className="artifact-command">
                        <span className="dim">{t('projects.artifact.recipe')}</span>
                        <code>{artifact.installCommand}</code>
                      </span>
                    )}
                    {artifact.verifyCommand && (
                      <span className="artifact-command">
                        <span className="dim">{t('projects.artifact.verify')}</span>
                        <code>{artifact.verifyCommand}</code>
                      </span>
                    )}
                    {artifact.risks.length > 0 && (
                      <span className="dim artifact-risks">
                        {t('projects.plan.warnings')}: {artifact.risks.join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>
      </RightPanelPortal>
    </div>
  );
}
