import { ServiceError } from './errors.ts';

/**
 * TEK AGIR IS KURALI — disk taramasi ile arac envanteri AYNI ANDA calismaz.
 *
 * Ikisi de diskte tam dolasir ve shim/modül atime'lerine dokunur. Paralel
 * calistirmak:
 *  - olcumu yavaslatir (ayni disk iki kez taranir),
 *  - kanit hijyenini bozar: envanter taramasi shim okurken disk taramasi
 *    ayni dosyalari okuyabilir; "kullanildi" kaniti kirlenir (E5/E6).
 *
 * Kapi TEK yerde tutulur; hem HTTP (web) hem CLI ayni kurali paylasir.
 * Servisler bu sinifi constructor'dan alir (varsayilan: kendi kendine
 * yeterli yeni kapi), boylece CLI tek is calistirirken de guvenlidir.
 */
export type ActivityKind = 'scan' | 'inventory';

const LABEL: Record<ActivityKind, string> = {
  scan: 'Disk taraması',
  inventory: 'Araç envanteri',
};

export class ActivityGate {
  private current: ActivityKind | null = null;

  /** Isi baslatir; baska tur bir is suruyorsa 409. Ayni tur is paylasilir. */
  begin(kind: ActivityKind): void {
    if (this.current === kind) return;
    if (this.current) {
      throw new ServiceError(
        409,
        `${LABEL[this.current]} sürüyor; bitmesini bekleyin.`,
      );
    }
    this.current = kind;
  }

  /** Is bitti (hata/iptal dahil): kilidi birakir. */
  end(kind: ActivityKind): void {
    if (this.current === kind) this.current = null;
  }

  /** Su an calisan agir is (yoksa null). Arayuz ipucu icin kullanabilir. */
  busy(): ActivityKind | null {
    return this.current;
  }
}
