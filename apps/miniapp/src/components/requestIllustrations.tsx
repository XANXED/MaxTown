import type { ReactNode } from 'react';
import { categoryVisual } from './categoryVisuals.ts';
import {
  AlertBadge,
  Basin,
  Bin,
  BrokenBadge,
  Ceiling,
  CeilingLamp,
  Drop,
  EntranceDoor,
  Faucet,
  Floor,
  IntercomPanel,
  Joint,
  LiftDoors,
  Litter,
  Pipe,
  Puddle,
  Radiator,
  Scene,
  Slab,
  Smoke,
  Snowflake,
  Socket,
  Spark,
  Stairs,
  Switch,
  Toilet,
  TrashBag,
  Window,
  type IllustrationTone,
} from './illustrationKit.tsx';

// Иллюстрации подкатегорий Заявки (docs/adr/0012): по картинке Жилец узнаёт
// свою поломку. Главная пара — стояк (толстая труба через перекрытия) и
// подводка (тонкий шланг от стояка к раковине). Сцены собраны из деталей
// illustrationKit.tsx; у «Другое» картинки нет — вместо неё значок Категории.

/** Затемнение сцены: нет света, ночь. */
function Dim() {
  return <rect className="illustration__dim" width={120} height={90} rx={14} />;
}

/** Большой смеситель: кончик излива — (x + 40.8, y + 37.4). */
function BigFaucet({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(1.7)`}>
      <Faucet x={0} y={0} />
    </g>
  );
}

/** Сцены по id подкатегории: id уникальны во всём справочнике, кроме «other». */
export const REQUEST_SCENES: Record<string, ReactNode> = {
  // Вода
  riser: (
    <>
      <Slab y={24} />
      <Slab y={60} />
      <Pipe x={46} y={4} width={16} height={82} />
      <Joint x={43} y={38} width={22} height={7} />
      <Drop cx={70} cy={46} r={3} />
      <Drop cx={73} cy={53} r={2.2} />
      <Puddle cx={76} cy={58.5} rx={13} ry={2} />
    </>
  ),
  supply: (
    <>
      <Floor y={80} />
      <Pipe x={100} y={4} width={12} height={76} />
      <Joint x={97} y={58} width={18} height={6} />
      <rect className="illustration__tone" x={87} y={58} width={11} height={6} rx={2} />
      <Basin x={16} y={40} width={48} />
      <Faucet x={28} y={21} />
      <path className="illustration__hose" d="M88 61 C72 61 68 76 54 71 C44 67 42 62 40 57" strokeWidth={3} fill="none" />
      <Drop cx={66} cy={75} r={2.6} />
      <Puddle cx={66} cy={83} rx={11} ry={2} />
    </>
  ),
  'no-water': (
    <>
      <BigFaucet x={16} y={12} />
      <Basin x={34} y={70} width={52} />
      <BrokenBadge cx={86} cy={32} />
    </>
  ),
  'weak-pressure': (
    <>
      <BigFaucet x={16} y={12} />
      <rect className="illustration__water" x={56.3} y={50} width={1.6} height={19} rx={0.8} />
      <Basin x={34} y={70} width={52} />
      <circle className="illustration__water" cx={52} cy={66} r={1} />
      <circle className="illustration__water" cx={62} cy={67} r={1} />
    </>
  ),
  'dirty-water': (
    <>
      <Floor y={84} />
      <g transform="translate(12 8) scale(1.5)">
        <Faucet x={0} y={0} />
      </g>
      <rect className="illustration__rust" x={46.5} y={41} width={3} height={15} rx={1.5} />
      <path className="illustration__surface" d="M36 58 H60 L57 84 H39 Z" />
      <path className="illustration__rust" d="M37.6 64 H58.4 L56.2 82.5 H39.8 Z" />
      <circle className="illustration__rust" cx={80} cy={76} r={5} />
      <circle className="illustration__rust-soft" cx={92} cy={79} r={3} />
    </>
  ),
  'basement-flood': (
    <>
      <Window x={12} y={10} width={22} height={13} />
      <Pipe x={4} y={30} width={112} height={7} />
      <rect className="illustration__tone-soft" x={20} y={46} width={18} height={16} rx={2} />
      <Drop cx={72} cy={43} r={2.4} />
      <Drop cx={80} cy={49} r={1.8} />
      <path
        className="illustration__water-soft"
        d="M0 56 Q15 51 30 56 T60 56 T90 56 T120 56 V76 Q120 90 106 90 H14 Q0 90 0 76 Z"
      />
      <AlertBadge cx={102} cy={16} />
    </>
  ),

  // Сантехника
  'sink-clog': (
    <>
      <BigFaucet x={14} y={4} />
      <Basin x={24} y={46} width={72} fill="water" />
      <circle className="illustration__bubble" cx={50} cy={56} r={2.5} strokeWidth={1.5} fill="none" />
      <circle className="illustration__bubble" cx={70} cy={54} r={3.5} strokeWidth={1.5} fill="none" />
      <circle className="illustration__bubble" cx={61} cy={60} r={1.8} strokeWidth={1.5} fill="none" />
      <BrokenBadge cx={100} cy={18} />
    </>
  ),
  'toilet-clog': (
    <>
      <Floor y={80} />
      <Toilet x={26} floorY={80} water="high" />
      <rect className="illustration__tone" x={86} y={30} width={4} height={40} rx={2} />
      <path className="illustration__danger" d="M76 80 Q76 66 88 66 Q100 66 100 80 Z" />
    </>
  ),
  'faucet-leak': (
    <>
      <BigFaucet x={20} y={6} />
      <Drop cx={60.8} cy={52} r={3} />
      <Drop cx={60.8} cy={62} r={2.4} />
      <Drop cx={60.8} cy={71} r={1.8} />
      <rect className="illustration__metal" x={28} y={78} width={66} height={4} rx={2} />
      <Puddle cx={61} cy={77} rx={12} ry={1.8} />
      <Drop cx={40} cy={30} r={1.6} />
    </>
  ),
  'toilet-leak': (
    <>
      <Floor y={80} />
      <Toilet x={40} floorY={80} />
      <Drop cx={38} cy={62} r={2.4} />
      <Drop cx={37} cy={70} r={1.8} />
      <Puddle cx={44} cy={81} rx={16} ry={2.5} />
    </>
  ),
  'sewer-clog': (
    <>
      <Slab y={28} />
      <Slab y={62} />
      <Pipe x={50} y={4} width={18} height={82} className="illustration__metal-dark" />
      <Pipe x={14} y={46} width={38} height={8} className="illustration__metal-dark" />
      <rect className="illustration__sewage" x={53} y={36} width={12} height={30} rx={3} />
      <rect className="illustration__metal-dark" x={52} y={66} width={14} height={10} rx={4} />
      <rect className="illustration__sewage" x={20} y={48} width={30} height={4} rx={2} />
      <BrokenBadge cx={96} cy={18} />
    </>
  ),
  'sewer-leak': (
    <>
      <Floor y={74} />
      <Window x={12} y={8} width={22} height={13} />
      <Pipe x={4} y={48} width={112} height={12} className="illustration__metal-dark" />
      <Joint x={56} y={45} width={10} height={18} />
      <Drop cx={70} cy={66} r={2.5} className="illustration__sewage" />
      <Puddle cx={70} cy={80} rx={22} ry={3.5} className="illustration__sewage" />
    </>
  ),

  // Отопление
  'cold-radiator': (
    <>
      <Floor y={80} />
      <Window x={32} y={8} width={52} height={34} />
      <Radiator x={36} y={50} sections={5} height={24} />
      <Snowflake cx={100} cy={24} r={9} />
    </>
  ),
  'radiator-leak': (
    <>
      <Floor y={80} />
      <Pipe x={12} y={6} width={7} height={74} />
      <rect className="illustration__metal" x={18} y={45} width={8} height={4} rx={1} />
      <rect className="illustration__metal" x={18} y={62} width={8} height={4} rx={1} />
      <Radiator x={26} y={40} sections={6} height={28} />
      <Drop cx={24} cy={72} r={2.6} />
      <Puddle cx={32} cy={81} rx={16} ry={2.5} />
    </>
  ),
  'heating-pipe-leak': (
    <>
      <Floor y={80} />
      <Pipe x={38} y={4} width={12} height={76} className="illustration__tone-soft" />
      <Joint x={35} y={36} width={18} height={6} />
      <rect className="illustration__metal" x={50} y={57} width={20} height={4} rx={1} />
      <Radiator x={70} y={50} sections={4} height={24} />
      <Drop cx={58} cy={45} r={2.8} />
      <Drop cx={61} cy={52} r={2} />
      <Smoke cx={24} cy={36} />
      <Puddle cx={58} cy={81} rx={12} ry={2} />
    </>
  ),
  'cold-stairwell': (
    <>
      <Floor y={80} />
      <Stairs x={42} floorY={80} steps={5} stepWidth={14} stepHeight={8} />
      <Window x={10} y={10} width={24} height={28} />
      <Radiator x={10} y={54} sections={3} height={20} />
      <Snowflake cx={64} cy={22} r={9} />
    </>
  ),

  // Электричество
  'no-power': (
    <>
      <Floor y={78} />
      <Window x={80} y={16} width={28} height={30} night />
      <CeilingLamp cx={40} cord={14} />
      <Switch cx={96} cy={62} />
      <Dim />
      <BrokenBadge cx={40} cy={52} />
    </>
  ),
  socket: (
    <>
      <Socket cx={42} cy={46} size={32} />
      <Switch cx={84} cy={46} />
      <BrokenBadge cx={100} cy={18} />
    </>
  ),
  sparking: (
    <>
      <Socket cx={46} cy={52} size={32} />
      <Smoke cx={72} cy={30} />
      <Spark cx={66} cy={44} r={10} />
      <Spark cx={58} cy={66} r={5} />
      <AlertBadge cx={102} cy={16} />
    </>
  ),
  breaker: (
    <>
      <rect className="illustration__surface" x={20} y={14} width={80} height={62} rx={5} />
      <rect className="illustration__metal" x={26} y={30} width={68} height={4} rx={1} />
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const x = 29 + index * 11;
        const tripped = index === 3;
        return (
          <g key={index}>
            <rect className="illustration__metal" x={x} y={34} width={8} height={24} rx={2} />
            <rect className={tripped ? 'illustration__danger' : 'illustration__metal-dark'} x={x + 2} y={tripped ? 49 : 38} width={4} height={6} rx={1} />
          </g>
        );
      })}
      <polygon className="illustration__warm" points="104,10 97,24 103,24 99,36 110,19 104,19 108,10" />
    </>
  ),
  'stair-light': (
    <>
      <Ceiling y={8} />
      <Floor y={80} />
      <Stairs x={30} floorY={80} steps={5} stepWidth={16} stepHeight={8} />
      <CeilingLamp cx={36} top={8} cord={10} />
      <Dim />
      <BrokenBadge cx={100} cy={20} />
    </>
  ),
  panel: (
    <>
      <rect className="illustration__metal" x={26} y={14} width={48} height={62} rx={3} />
      <rect className="illustration__metal-dark" x={30} y={18} width={40} height={54} rx={2} />
      {[0, 1, 2, 3].map((index) => (
        <rect key={index} className="illustration__metal" x={34 + index * 9} y={24} width={6} height={14} rx={1.5} />
      ))}
      <path className="illustration__wire" d="M38 38 C36 52 44 56 40 70" strokeWidth={2} fill="none" />
      <path className="illustration__wire-warm" d="M52 38 C56 50 48 58 54 70" strokeWidth={2} fill="none" />
      <path className="illustration__surface" d="M74 14 L96 20 V80 L74 76 Z" />
      <rect className="illustration__metal" x={90} y={44} width={3} height={10} rx={1.5} />
      <AlertBadge cx={104} cy={14} />
    </>
  ),
  'yard-light': (
    <>
      <Floor y={74} />
      <rect className="illustration__metal" x={36} y={22} width={4} height={52} rx={1} />
      <rect className="illustration__metal" x={36} y={22} width={20} height={3} rx={1.5} />
      <path className="illustration__surface" d="M50 25 H62 L59 33 H53 Z" />
      <rect className="illustration__metal-dark" x={70} y={32} width={36} height={5} rx={1} />
      <EntranceDoor x={76} y={37} width={24} height={37} />
      <Dim />
      <BrokenBadge cx={56} cy={46} />
    </>
  ),

  // Лифты
  'lift-stopped': (
    <>
      <Floor y={82} />
      <rect className="illustration__metal-dark" x={48} y={6} width={24} height={9} rx={2} />
      <rect className="illustration__danger" x={54} y={9.5} width={12} height={2} rx={1} />
      <LiftDoors x={34} y={18} width={52} height={64} />
      <BrokenBadge cx={100} cy={20} />
    </>
  ),
  'lift-doors': (
    <>
      <Floor y={82} />
      <LiftDoors x={30} y={14} width={60} height={68} gap={14} />
      <path className="illustration__arrow" d="M40 48 L50 48 M46 44 L50 48 L46 52 M80 48 L70 48 M74 44 L70 48 L74 52" strokeWidth={2.5} fill="none" />
      <BrokenBadge cx={104} cy={18} />
    </>
  ),
  'lift-buttons': (
    <>
      <rect className="illustration__metal" x={40} y={8} width={40} height={74} rx={6} />
      {[0, 1, 2, 3].map((row) => [0, 1].map((column) => (
        <circle key={`${row}-${column}`} className="illustration__surface" cx={52 + column * 16} cy={22 + row * 15} r={5} />
      )))}
      <circle className="illustration__tone" cx={52} cy={37} r={2} />
      <BrokenBadge cx={68} cy={52} />
    </>
  ),
  'lift-cabin': (
    <>
      <Ceiling y={10} />
      <Floor y={76} />
      <rect className="illustration__slab" x={4} y={10} width={10} height={66} />
      <rect className="illustration__slab" x={106} y={10} width={10} height={66} />
      <rect className="illustration__metal-dark" x={46} y={10} width={28} height={4} rx={1} />
      <rect className="illustration__metal" x={20} y={48} width={80} height={3} rx={1.5} />
      <Litter x={40} y={81} />
      <Litter x={76} y={79} />
      <Dim />
    </>
  ),

  // Интернет
  cable: (
    <>
      <Ceiling y={10} />
      <rect className="illustration__metal" x={0} y={10} width={120} height={5} />
      <path className="illustration__cable" d="M4 20 C30 22 46 30 52 46" strokeWidth={3.5} fill="none" />
      <path className="illustration__cable" d="M116 20 C94 22 76 34 70 52" strokeWidth={3.5} fill="none" />
      <Spark cx={53} cy={50} r={5} />
      <Spark cx={69} cy={56} r={4} />
      <Floor y={84} />
    </>
  ),
  'no-internet': (
    <>
      <path className="illustration__muted-line" d="M44 34 Q60 20 76 34 M50 40 Q60 31 70 40" strokeWidth={3} fill="none" />
      <rect className="illustration__metal-dark" x={40} y={40} width={4} height={14} rx={2} />
      <rect className="illustration__metal-dark" x={76} y={40} width={4} height={14} rx={2} />
      <rect className="illustration__tone" x={34} y={52} width={52} height={18} rx={5} />
      <circle className="illustration__surface" cx={46} cy={61} r={2} />
      <circle className="illustration__surface" cx={54} cy={61} r={2} />
      <circle className="illustration__danger" cx={62} cy={61} r={2} />
      <rect className="illustration__metal" x={24} y={70} width={72} height={4} rx={2} />
      <BrokenBadge cx={96} cy={24} />
    </>
  ),

  // Домофон
  'entrance-door': (
    <>
      <Floor y={82} />
      <rect className="illustration__metal-dark" x={24} y={16} width={50} height={5} rx={1} />
      <EntranceDoor x={30} y={21} width={38} height={61} />
      <IntercomPanel x={78} y={40} />
      <BrokenBadge cx={100} cy={20} />
    </>
  ),
  key: (
    <>
      <g transform="translate(18 10) scale(1.8)">
        <IntercomPanel x={0} y={0} />
      </g>
      <path className="illustration__tone" d="M78 48 Q86 40 94 48 L90 66 Q86 70 82 66 Z" />
      <circle className="illustration__bg" cx={86} cy={50} r={2.2} />
      <path className="illustration__arrow" d="M72 58 L62 58 M66 54 L62 58 L66 62" strokeWidth={2.5} fill="none" />
      <BrokenBadge cx={100} cy={20} />
    </>
  ),
  handset: (
    <>
      <rect className="illustration__surface" x={36} y={12} width={36} height={60} rx={6} />
      <rect className="illustration__metal" x={40} y={16} width={11} height={52} rx={5} />
      {[0, 1, 2].map((row) => (
        <circle key={row} className="illustration__metal-dark" cx={62} cy={28 + row * 7} r={1.5} />
      ))}
      <rect className="illustration__tone" x={56} y={54} width={12} height={6} rx={3} />
      <path className="illustration__muted-line" d="M80 32 Q86 40 80 48 M86 26 Q96 40 86 54" strokeWidth={2.5} fill="none" />
      <BrokenBadge cx={100} cy={18} />
    </>
  ),
  'door-closer': (
    <>
      <Floor y={82} />
      <rect className="illustration__night" x={30} y={20} width={44} height={62} rx={2} />
      <rect className="illustration__metal-dark" x={26} y={16} width={52} height={5} rx={1} />
      <path className="illustration__tone" d="M30 21 L54 28 V78 L30 82 Z" />
      <rect className="illustration__metal-dark" x={58} y={21} width={14} height={5} rx={1.5} />
      <path className="illustration__arrow" d="M64 26 L58 31 M49 29 L54 30" strokeWidth={2.5} fill="none" />
      <BrokenBadge cx={100} cy={20} />
    </>
  ),

  // Уборка
  'stairs-litter': (
    <>
      <Floor y={82} />
      <Stairs x={18} floorY={82} steps={5} stepWidth={17} stepHeight={9} />
      <Litter x={24} y={70} />
      <Litter x={58} y={52} />
      <Litter x={88} y={36} />
    </>
  ),
  bins: (
    <>
      <Floor y={82} />
      <Bin x={18} floorY={82} full />
      <Bin x={58} floorY={82} full />
      <TrashBag cx={100} bottom={82} />
    </>
  ),
  yard: (
    <>
      <Floor y={66} />
      <rect className="illustration__metal-dark" x={88} y={30} width={5} height={38} rx={2} />
      <circle className="illustration__leaf" cx={90} cy={24} r={13} />
      <circle className="illustration__leaf" cx={80} cy={32} r={8} />
      <path className="illustration__surface" d="M0 72 Q18 58 36 68 T72 66 T120 62 V76 Q120 90 106 90 H14 Q0 90 0 76 Z" />
      <rect className="illustration__tone" x={38} y={34} width={4} height={34} rx={2} transform="rotate(-14 40 50)" />
      <path className="illustration__metal" d="M34 64 H52 L50 74 H36 Z" transform="rotate(-14 43 69)" />
      <circle className="illustration__warm" cx={20} cy={60} r={2.5} />
      <circle className="illustration__tone" cx={66} cy={58} r={2} />
    </>
  ),
};

/** Есть ли у подкатегории своя сцена; у «Другое» — нет. */
export function hasScene(subcategory: string): boolean {
  return subcategory in REQUEST_SCENES;
}

/**
 * Картинка подкатегории. Своей сцены нет («Другое» или новый id) — крупный
 * значок Категории на той же подложке.
 */
export function RequestIllustration({ category, subcategory }: { category: string; subcategory: string }) {
  const visual = categoryVisual(category);
  const tone = visual.tone as IllustrationTone;
  const scene = REQUEST_SCENES[subcategory];
  if (scene) return <Scene tone={tone}>{scene}</Scene>;
  const Icon = visual.icon;
  return (
    <span className={`illustration illustration--${tone} illustration--fallback`} aria-hidden>
      <Icon className="illustration__icon" weight="fill" aria-hidden />
    </span>
  );
}
