import { TopBar } from '../components/TopBar'
import { TERRAINS } from '../data/terrains'
import {
  ARMY_BASE_POWER,
  LUCK_SWING,
  MATCH_BONUS,
  STARTING_COINS,
  VETERANCY_PER_WIN,
} from '../game/balance'
import { faNumber, faSigned, formatCoins } from '../game/format'

const STEPS = [
  {
    title: 'یک سلاح بردار',
    body: 'با تبر سنگی و تپانچهٔ ساده شروع می‌کنی. هر دو رایگان‌اند و هر دو واقعاً به درد می‌خورند — تبر، نبرد اول را به‌تنهایی می‌برد.',
  },
  {
    title: 'زمین را بخوان',
    body: 'هر نبرد روی یکی از پنج زمین اتفاق می‌افتد. صفحهٔ آماده‌سازی، پیش از آنکه تصمیم بگیری، دقیقاً نشان می‌دهد سلاحت اینجا چه چیزی به دست می‌آورد و چه چیزی از دست می‌دهد.',
  },
  {
    title: 'بجنگ',
    body: 'قدرت تو یعنی سپاهت، به‌اضافهٔ سلاحت، به‌اضافهٔ زمین، به‌اضافهٔ کمی شانس. هر کس قدرت بیشتری داشته باشد می‌برد.',
  },
  {
    title: 'سکه‌هایت را خرج کن',
    body: 'بردن سکه می‌آورد. سلاح‌ها یک بار خریده می‌شوند و برای همیشه می‌مانند — استفاده از آن‌ها هیچ‌وقت تمامشان نمی‌کند.',
  },
  {
    title: 'فرماندهٔ آینده را شکست بده',
    body: 'شش نبرد بین تو و آخرین پایتخت فاصله است. نبرد آخر سخت است، اما هر سلاحی که داری، یک میدان دارد که در آن می‌درخشد.',
  },
]

interface HowToPlayProps {
  onBack: () => void
}

export function HowToPlay({ onBack }: HowToPlayProps) {
  return (
    <div className="screen">
      <TopBar title="📖 راهنمای بازی" onBack={onBack} />

      <div className="shell stack">
        <section className="card stack">
          <h2 className="subtitle">تمام بازی در یک جمله</h2>
          <p className="body">
            سلاحِ مناسبِ زمین، از سلاح گران‌قیمت بهتر است. تمام راهبرد بازی همین است.
          </p>
        </section>

        <section className="stack">
          {STEPS.map((step, index) => (
            <div key={step.title} className="guide__step">
              <span className="guide__num" aria-hidden="true">
                {faNumber(index + 1)}
              </span>
              <div>
                <p className="subtitle">{step.title}</p>
                <p className="small">{step.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="card stack stack--tight">
          <h2 className="subtitle">قدرت چطور حساب می‌شود</h2>
          <div className="breakdown">
            <div className="breakdown__row">
              <span>سپاه پایهٔ تو</span>
              <b className="num">{faNumber(ARMY_BASE_POWER)}</b>
            </div>
            <div className="breakdown__row">
              <span>سلاح تو</span>
              <b className="num">+ قدرت سلاح</b>
            </div>
            <div className="breakdown__row">
              <span>تناسب با زمین</span>
              <b className="num">± تا {faNumber(MATCH_BONUS + 40)}</b>
            </div>
            <div className="breakdown__row">
              <span>سربازان کارکشته (هر برد)</span>
              <b className="num">{faSigned(VETERANCY_PER_WIN)}</b>
            </div>
            <div className="breakdown__row">
              <span>شانس</span>
              <b className="num">± {faNumber(LUCK_SWING)}</b>
            </div>
            <div className="breakdown__row breakdown__row--total">
              <span style={{ color: 'var(--ink)' }}>قدرت نبرد</span>
              <b className="num">= جمع کل</b>
            </div>
          </div>
          <p className="small">
            سلاحی که روی زمینِ ساختِ خودش بجنگد، کامل {faSigned(MATCH_BONUS)} امتیاز می‌گیرد. این عدد
            معمولاً از فاصلهٔ بین یک سلاح ارزان و یک سلاح گران بزرگ‌تر است.
          </p>
        </section>

        <section className="stack">
          <h2 className="subtitle">پنج میدان نبرد</h2>
          {TERRAINS.map((terrain) => (
            <div key={terrain.id} className="terrain-row">
              <span className="terrain-row__emoji" aria-hidden="true">
                {terrain.emoji}
              </span>
              <div>
                <p className="subtitle" style={{ fontSize: 'var(--fs-md)' }}>
                  {terrain.name}
                </p>
                <p className="small">{terrain.description}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="card stack stack--tight">
          <h2 className="subtitle">سکه‌ها</h2>
          <p className="small">
            با {formatCoins(STARTING_COINS)} 🪙 شروع می‌کنی. بردن هر نبرد، جایزهٔ کاملش را می‌دهد و
            این جایزه هر نبرد بزرگ‌تر می‌شود. باختن هم مقدار کمی سکه از میدان برایت جمع می‌کند، پس یک
            خرید بد هیچ‌وقت تو را زمین‌گیر نمی‌کند.
          </p>
        </section>

        <div className="action-bar">
          <button type="button" className="btn btn--primary btn--lg" onClick={onBack}>
            فهمیدم
          </button>
        </div>
      </div>
    </div>
  )
}
