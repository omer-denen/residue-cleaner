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
export class RestoreTarget {
  /** Ilk deneme: hedef bos ise <yol>; degilse <yol>.restored-<now>. */
  static initial(original: string, now: number, targetExists: boolean): string {
    if (!targetExists) return original;
    return `${original}.restored-${now}`;
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