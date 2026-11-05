/**
 * Geri yukleme hedef yolu uretimi (saf TS, yan etki yok).
 *
 * Kasaya tasinmis bir kayit geri yuklenirken hedef yol doluysa ezilmez;
 * bunun yerine `<yol>.restored-<zaman>` ve gerekirse
 * `<yol>.restored-<zaman>-<deneme>-<rastgele>` benzersiz adi kullanilir.
 *
 * Tum girdiler parametre olarak gelir (test edilebilirlik); fonksiyonlar
 * `original` degerini degistirmez.
 */
/**
 * Geri yukleme sirasinda hedefin durumu.
 *
 * `newer` / `older` icerik yasina bakar: hedefteki ust duzey girdilerin
 * en yeni mtime'i kasadaki silme zamanindan (`vaultedAt`) yeni/eski ise
 * ayrisir. Boylece "klasor dolu" gibi hem yanlis hem eksik bir uyari
 * yerine "konumda daha yeni icerik var" denebilir.
 */
export type RestoreTargetState = 'absent' | 'empty' | 'newer' | 'older' | 'unknown';

/** Dosya sistemi gozlemi; saf siniflandiriciya veri olarak girer. */
export interface RestoreTargetObservation {
  /** Ust duzey girdi sayisi (dosya hedefte 1). */
  entries: number;
  /** Ust duzey girdilerin en yeni mtime'i; bilinmiyorsa 0. */
  newestAt: number;
}

export class RestoreTarget {
  /** Ilk deneme: hedef bos ise <yol>; degilse <yol>.restored-<now>. */
  static initial(original: string, now: number, targetExists: boolean): string {
    if (!targetExists) return original;
    return `${original}.restored-${now}`;
  }

  /**
   * Hedef gozlemini duruma cevirir (saf).
   *
   * Tolerans (varsayilan 2 sn) dosya sistemi zaman cozunurlugu ve saat
   * kaymasi icin: bu araliktaki fark "ayni yas" sayilir ve `unknown`
   * doner; iddia edilemeyecek bir sey soylenmez.
   */
  static classify(
    observed: RestoreTargetObservation | null,
    vaultedAt: number,
    toleranceMs = 2_000,
  ): RestoreTargetState {
    if (!observed) return 'absent';
    if (observed.entries <= 0) return 'empty';
    if (!Number.isFinite(observed.newestAt) || observed.newestAt <= 0) return 'unknown';
    if (observed.newestAt > vaultedAt + toleranceMs) return 'newer';
    if (observed.newestAt < vaultedAt - toleranceMs) return 'older';
    return 'unknown';
  }

  /**
   * Yeniden deneme adi: <yol>.restored-<now>-<attempt>-<rand>.
   * attempt 1'den baslar; ad deterministik degildir (rand verilir).
   */
  static retry(original: string, now: number, attempt: number, rand: string): string {
    return `${original}.restored-${now}-${attempt}-${rand}`;
  }

  /** Bu hata kodlari yeni adla yeniden denenir. */
  static isRetryableCode(code: string | undefined): boolean {
    return (
      code === 'ENOTEMPTY' ||
      code === 'EEXIST' ||
      code === 'ENOTDIR' ||
      code === 'EPERM' ||
      code === 'EACCES' ||
      code === 'EBUSY'
    );
  }
}