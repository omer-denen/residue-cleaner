import { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../../../src/core/contract.ts';
import { translate, type Lang, type MessageKey } from '../i18n.ts';
import { PROFILE_IDS } from '../profiles.ts';
import { onboardingChoice } from '../onboarding.ts';

interface Props {
  lang: Lang;
  open: boolean;
  onChoose: (id: UserProfile) => void;
}

/**
 * Ilk acilis onboarding diyalogu. Karar vermez: secilen kimligi onChoose
 * ile yukari iletir; asil yazma App.tsx tarafinda yapilir.
 */
export function Onboarding({ lang, open, onChoose }: Props) {
  const t = (key: MessageKey) => translate(lang, key);
  const [selected, setSelected] = useState<UserProfile>('hybrid');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setSelected('hybrid');
    // Ilk secenek odaklanir (bir sonraki tick).
    const id = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onChoose('hybrid');
        return;
      }
      if (e.key !== 'Tab') return;
      const dlg = dialogRef.current;
      if (!dlg) return;
      const focusable = Array.from(
        dlg.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dlg)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Kapanista odak main basligina doner (document.body degil).
      const main = document.getElementById('main');
      if (main) {
        (main as HTMLElement).focus?.();
      } else {
        openerRef.current?.focus?.();
      }
    };
  }, [open, onChoose]);

  if (!open) return null;

  const nameFor = (id: UserProfile): string =>
    t(`settings.profile.${id}` as MessageKey);

  return (
    <div className="dialog-backdrop onboarding-backdrop" onClick={() => onChoose('hybrid')}>
      <div
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="onboarding-head">
          <h2 id="onboarding-title">{t('onboarding.title')}</h2>
          <p className="onboarding-hint">{t('onboarding.hint')}</p>
        </header>

        <div className="onboarding-cards" role="group" aria-labelledby="onboarding-title">
          {PROFILE_IDS.map((id, idx) => {
            const checked = selected === id;
            return (
              <button
                key={id}
                type="button"
                ref={idx === 0 ? firstRef : undefined}
                className={`onboarding-card${checked ? ' is-checked' : ''}`}
                aria-pressed={checked}
                onClick={() => setSelected(id)}
              >
                <span className="onboarding-card-name">{nameFor(id)}</span>
                <span className="onboarding-card-copy">{t(`profile.copy.${id}` as MessageKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="onboarding-actions">
          <button
            type="button"
            className="primary"
            onClick={() => onChoose(onboardingChoice(selected))}
          >
            {t('onboarding.continue')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onChoose('hybrid')}
          >
            {t('onboarding.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
