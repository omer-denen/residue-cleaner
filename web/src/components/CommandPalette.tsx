import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { CommandView } from '../../../src/core/command-view.ts';
import { translate, type Lang, type MessageKey } from '../i18n.ts';
import { Icon } from './icons.tsx';
import { nextFocusIndex } from '../a11y/focus-trap.ts';

/** Palet ogesi: kimlik + gorunen ad; filtreleme MOTORDA (kural 18). */
export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
}

/**
 * Komut paleti (Ctrl/Cmd+K): ekranlar ve eylemler tek arama kutusunda.
 *
 * Karar YOK: aday listesi App'ten gelir, eslestirme `command-view.ts`te.
 * Klavye: ↑↓ gezin, Enter calistir, Esc kapat. Odak ilk acilista aramada.
 */
export function CommandPalette({
  lang,
  items,
  onRun,
  onClose,
}: {
  lang: Lang;
  items: PaletteItem[];
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const matches = useMemo(() => CommandView.filter(query, items, 14), [query, items]);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dlg = dialogRef.current;
      if (!dlg) return;
      const focusable = Array.from(
        dlg.querySelectorAll<HTMLElement>(
          'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active ? focusable.indexOf(active) : -1;
      const next = nextFocusIndex(current, focusable.length, e.shiftKey, current >= 0);
      if (next < 0) return;
      e.preventDefault();
      focusable[next]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Palet kapaninca odak acan dugmeye doner; body'ye dusmez.
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const run = (id: string): void => {
    onRun(id);
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => CommandView.move(i, 1, matches.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => CommandView.move(i, -1, matches.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = matches[index] ?? matches[0];
      if (picked) run(picked.id);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
      >
        <div className="palette-search">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={matches[index] ? `palette-${matches[index]!.id}` : undefined}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>

        {matches.length === 0 ? (
          <p className="palette-empty">{t('palette.empty')}</p>
        ) : (
          <ul className="palette-list" id="palette-list" role="listbox">
            {matches.map((item, i) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={i === index}
                  className={`palette-item${i === index ? ' active' : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(item.id)}
                >
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="palette-foot">
          <span aria-live="polite">{t('palette.results', { n: matches.length })}</span>
          <span>{t('palette.hint')}</span>
        </p>
      </div>
    </div>
  );
}
