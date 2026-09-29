import type { ReactNode } from 'react';

// Детали иллюстраций подкатегорий Заявки. Сцена 120×90; цвета — только
// CSS-классы .illustration__* на токенах (app.css), поэтому картинки
// работают в светлой и тёмной теме. Стиль — плоские формы с бликом, без
// градиентов (design/AGENTS.md). Координаты — единицы сцены, не отступы.

export const SCENE_WIDTH = 120;
export const SCENE_HEIGHT = 90;
const RADIUS = 14;

export type IllustrationTone = 'blue' | 'teal' | 'green' | 'pink' | 'coral' | 'neutral';

/** Сцена: подложка в тоне Категории. Картинка декоративная — смысл несёт подпись. */
export function Scene({ tone, children }: { tone: IllustrationTone; children: ReactNode }) {
  return (
    <svg
      className={`illustration illustration--${tone}`}
      viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
      aria-hidden
      focusable="false"
    >
      <rect className="illustration__bg" width={SCENE_WIDTH} height={SCENE_HEIGHT} rx={RADIUS} />
      {children}
    </svg>
  );
}

/** Пол от высоты y до низа сцены, с теми же скруглёнными углами, что у подложки. */
export function Floor({ y, className = 'illustration__floor' }: { y: number; className?: string }) {
  const bottom = SCENE_HEIGHT;
  return (
    <path
      className={className}
      d={`M0 ${y} H${SCENE_WIDTH} V${bottom - RADIUS} Q${SCENE_WIDTH} ${bottom} ${SCENE_WIDTH - RADIUS} ${bottom} H${RADIUS} Q0 ${bottom} 0 ${bottom - RADIUS} Z`}
    />
  );
}

/** Потолок сверху до y: для лестниц и кабины лифта. */
export function Ceiling({ y }: { y: number }) {
  return <path className="illustration__slab" d={`M0 ${RADIUS} Q0 0 ${RADIUS} 0 H${SCENE_WIDTH - RADIUS} Q${SCENE_WIDTH} 0 ${SCENE_WIDTH} ${RADIUS} V${y} H0 Z`} />;
}

/** Межэтажное перекрытие во всю ширину. */
export function Slab({ y, height = 5 }: { y: number; height?: number }) {
  return <rect className="illustration__slab" x={0} y={y} width={SCENE_WIDTH} height={height} />;
}

type Box = { x: number; y: number; width: number; height: number };

/** Труба с бликом: вертикальная или горизонтальная по пропорции. */
export function Pipe({ x, y, width, height, className = 'illustration__metal' }: Box & { className?: string }) {
  const vertical = height >= width;
  const thickness = vertical ? width : height;
  return (
    <g>
      <rect className={className} x={x} y={y} width={width} height={height} rx={thickness * 0.3} />
      {vertical ? (
        <rect className="illustration__shine" x={x + width * 0.18} y={y + 2} width={Math.max(1.5, width * 0.18)} height={Math.max(0, height - 4)} rx={1} />
      ) : (
        <rect className="illustration__shine" x={x + 2} y={y + height * 0.18} width={Math.max(0, width - 4)} height={Math.max(1.5, height * 0.18)} rx={1} />
      )}
    </g>
  );
}

/** Муфта или соединение на трубе. */
export function Joint({ x, y, width, height }: Box) {
  return <rect className="illustration__metal-dark" x={x} y={y} width={width} height={height} rx={2} />;
}

/** Капля с центром (cx, cy) и радиусом r; острый кончик вверху. */
export function Drop({ cx, cy, r, className = 'illustration__water' }: { cx: number; cy: number; r: number; className?: string }) {
  return (
    <path
      className={className}
      d={`M${cx} ${cy - r * 1.7} C${cx + r * 0.55} ${cy - r * 0.8} ${cx + r} ${cy - r * 0.25} ${cx + r} ${cy + r * 0.3} A${r} ${r} 0 0 1 ${cx - r} ${cy + r * 0.3} C${cx - r} ${cy - r * 0.25} ${cx - r * 0.55} ${cy - r * 0.8} ${cx} ${cy - r * 1.7} Z`}
    />
  );
}

/** Лужа на полу. */
export function Puddle({ cx, cy, rx, ry = 3, className = 'illustration__water-soft' }: { cx: number; cy: number; rx: number; ry?: number; className?: string }) {
  return <ellipse className={className} cx={cx} cy={cy} rx={rx} ry={ry} />;
}

/** Значок «не работает»: красный круг с крестом. */
export function BrokenBadge({ cx = 100, cy = 18 }: { cx?: number; cy?: number }) {
  return (
    <g>
      <circle className="illustration__danger" cx={cx} cy={cy} r={9} />
      <path className="illustration__mark" d={`M${cx - 3.5} ${cy - 3.5} L${cx + 3.5} ${cy + 3.5} M${cx + 3.5} ${cy - 3.5} L${cx - 3.5} ${cy + 3.5}`} strokeWidth={2.5} />
    </g>
  );
}

/** Значок опасности: оранжевый круг с восклицательным знаком. */
export function AlertBadge({ cx = 100, cy = 18 }: { cx?: number; cy?: number }) {
  return (
    <g>
      <circle className="illustration__warm" cx={cx} cy={cy} r={9} />
      <path className="illustration__mark" d={`M${cx} ${cy - 4.5} V${cy + 1}`} strokeWidth={2.5} />
      <circle className="illustration__mark-fill" cx={cx} cy={cy + 4.5} r={1.4} />
    </g>
  );
}

/** Снежинка: холодно. */
export function Snowflake({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const arms = [0, 60, 120].map((angle) => {
    const radians = (angle * Math.PI) / 180;
    const dx = Math.cos(radians) * r;
    const dy = Math.sin(radians) * r;
    return `M${cx - dx} ${cy - dy} L${cx + dx} ${cy + dy}`;
  });
  return <path className="illustration__cold" d={arms.join(' ')} strokeWidth={2.5} />;
}

/** Искра: звезда из лучей. */
export function Spark({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const points = Array.from({ length: 12 }, (_, index) => {
    const radius = index % 2 === 0 ? r : r * 0.42;
    const angle = (index * Math.PI) / 6 - Math.PI / 2;
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
  });
  return <polygon className="illustration__warm" points={points.join(' ')} />;
}

/** Дым: несколько серых клубов. */
export function Smoke({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="illustration__smoke">
      <circle cx={cx} cy={cy} r={5} />
      <circle cx={cx + 6} cy={cy - 5} r={6} />
      <circle cx={cx + 1} cy={cy - 12} r={4.5} />
    </g>
  );
}

/** Смеситель на стене: корпус, излив вниз и ручка. Кончик излива — (x + 24, y + 22). */
export function Faucet({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect className="illustration__metal" x={x} y={y + 4} width={10} height={10} rx={2} />
      <Pipe x={x + 8} y={y + 6} width={20} height={6} />
      <rect className="illustration__metal" x={x + 21} y={y + 8} width={6} height={14} rx={2} />
      <rect className="illustration__tone" x={x + 12} y={y} width={12} height={4} rx={2} />
      <rect className="illustration__metal-dark" x={x + 16} y={y + 2} width={4} height={5} rx={1} />
    </g>
  );
}

/** Раковина спереди: чаша от x до x + width, верх на y. */
export function Basin({ x, y, width, fill }: { x: number; y: number; width: number; fill?: 'water' | 'rust' }) {
  const depth = width * 0.34;
  return (
    <g>
      <path className="illustration__surface" d={`M${x} ${y} H${x + width} Q${x + width - 4} ${y + depth} ${x + width / 2} ${y + depth} Q${x + 4} ${y + depth} ${x} ${y} Z`} />
      {fill ? (
        <path
          className={fill === 'water' ? 'illustration__water-soft' : 'illustration__rust-soft'}
          d={`M${x + 3} ${y + 3} H${x + width - 3} Q${x + width - 6} ${y + depth - 2} ${x + width / 2} ${y + depth - 2} Q${x + 6} ${y + depth - 2} ${x + 3} ${y + 3} Z`}
        />
      ) : null}
      <rect className="illustration__metal" x={x - 3} y={y - 3} width={width + 6} height={4} rx={2} />
    </g>
  );
}

/** Унитаз сбоку: бачок сзади, чаша впереди. Низ — на уровне floorY. */
export function Toilet({ x, floorY, water }: { x: number; floorY: number; water?: 'high' }) {
  return (
    <g>
      <rect className="illustration__surface" x={x} y={floorY - 44} width={16} height={22} rx={3} />
      <rect className="illustration__metal" x={x + 3} y={floorY - 48} width={10} height={4} rx={2} />
      <path className="illustration__surface" d={`M${x + 4} ${floorY - 22} H${x + 40} Q${x + 40} ${floorY - 10} ${x + 28} ${floorY - 8} L${x + 26} ${floorY} H${x + 12} L${x + 12} ${floorY - 9} Q${x + 4} ${floorY - 12} ${x + 4} ${floorY - 22} Z`} />
      <rect className="illustration__metal" x={x + 4} y={floorY - 24} width={37} height={3} rx={1.5} />
      {water === 'high' ? <rect className="illustration__water-soft" x={x + 8} y={floorY - 21} width={30} height={5} rx={2.5} /> : null}
    </g>
  );
}

/** Батарея из секций. */
export function Radiator({ x, y, sections = 5, height = 26, tone = false }: { x: number; y: number; sections?: number; height?: number; tone?: boolean }) {
  const width = 7;
  const gap = 2;
  return (
    <g>
      {Array.from({ length: sections }, (_, index) => (
        <g key={index}>
          <rect className={tone ? 'illustration__tone-soft' : 'illustration__surface'} x={x + index * (width + gap)} y={y} width={width} height={height} rx={3} />
          <rect className="illustration__shine" x={x + index * (width + gap) + 1.5} y={y + 3} width={1.5} height={height - 6} rx={0.75} />
        </g>
      ))}
      <rect className="illustration__metal" x={x - 2} y={y + height - 6} width={sections * (width + gap) + 2} height={3} rx={1.5} />
      <rect className="illustration__metal" x={x - 2} y={y + 3} width={sections * (width + gap) + 2} height={3} rx={1.5} />
    </g>
  );
}

/** Окно: рама и стекло; ночью стекло тёмное. */
export function Window({ x, y, width, height, night = false }: Box & { night?: boolean }) {
  return (
    <g>
      <rect className="illustration__surface" x={x} y={y} width={width} height={height} rx={3} />
      <rect className={night ? 'illustration__night' : 'illustration__water-soft'} x={x + 3} y={y + 3} width={width - 6} height={height - 6} rx={1.5} />
      <rect className="illustration__surface" x={x + width / 2 - 1} y={y + 3} width={2} height={height - 6} />
    </g>
  );
}

/** Розетка: рамка и два отверстия. */
export function Socket({ cx, cy, size = 22 }: { cx: number; cy: number; size?: number }) {
  const half = size / 2;
  return (
    <g>
      <rect className="illustration__surface" x={cx - half} y={cy - half} width={size} height={size} rx={size * 0.22} />
      <circle className="illustration__metal" cx={cx} cy={cy} r={half * 0.62} />
      <circle className="illustration__metal-dark" cx={cx - half * 0.28} cy={cy} r={1.6} />
      <circle className="illustration__metal-dark" cx={cx + half * 0.28} cy={cy} r={1.6} />
    </g>
  );
}

/** Выключатель: рамка и клавиша. */
export function Switch({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <rect className="illustration__surface" x={cx - 8} y={cy - 10} width={16} height={20} rx={4} />
      <rect className="illustration__metal" x={cx - 4} y={cy - 6} width={8} height={12} rx={2} />
    </g>
  );
}

/** Потолочная лампа на шнуре: горит или нет. */
export function CeilingLamp({ cx, top = 0, cord = 16, lit = false }: { cx: number; top?: number; cord?: number; lit?: boolean }) {
  const shadeY = top + cord;
  return (
    <g>
      <rect className="illustration__metal-dark" x={cx - 0.75} y={top} width={1.5} height={cord} />
      {lit ? <circle className="illustration__glow-soft" cx={cx} cy={shadeY + 12} r={14} /> : null}
      <path className="illustration__tone" d={`M${cx - 11} ${shadeY + 9} L${cx - 5} ${shadeY} H${cx + 5} L${cx + 11} ${shadeY + 9} Z`} />
      <circle className={lit ? 'illustration__glow' : 'illustration__metal'} cx={cx} cy={shadeY + 11} r={4} />
    </g>
  );
}

/** Лестница: ступени слева направо вверх. */
export function Stairs({ x, floorY, steps = 5, stepWidth = 12, stepHeight = 7 }: { x: number; floorY: number; steps?: number; stepWidth?: number; stepHeight?: number }) {
  let d = `M${x} ${floorY}`;
  for (let index = 0; index < steps; index += 1) {
    d += ` V${floorY - (index + 1) * stepHeight} H${x + (index + 1) * stepWidth}`;
  }
  d += ` V${floorY} Z`;
  return <path className="illustration__slab" d={d} />;
}

/** Двери лифта в портале; gap — щель между створками. */
export function LiftDoors({ x, y, width, height, gap = 0 }: Box & { gap?: number }) {
  const door = (width - 8 - gap) / 2;
  return (
    <g>
      <rect className="illustration__metal-dark" x={x} y={y} width={width} height={height} rx={3} />
      {gap > 0 ? <rect className="illustration__night" x={x + 4 + door} y={y + 4} width={gap} height={height - 4} /> : null}
      <rect className="illustration__metal" x={x + 4} y={y + 4} width={door} height={height - 4} rx={1.5} />
      <rect className="illustration__metal" x={x + 4 + door + gap} y={y + 4} width={door} height={height - 4} rx={1.5} />
      <rect className="illustration__shine" x={x + 7} y={y + 7} width={2} height={height - 10} rx={1} />
    </g>
  );
}

/** Дверь подъезда: полотно, ручка, окошко. */
export function EntranceDoor({ x, y, width, height }: Box) {
  return (
    <g>
      <rect className="illustration__tone" x={x} y={y} width={width} height={height} rx={3} />
      <rect className="illustration__tone-soft" x={x + 5} y={y + 6} width={width - 10} height={height * 0.3} rx={2} />
      <rect className="illustration__surface" x={x + width - 9} y={y + height * 0.55} width={4} height={10} rx={2} />
    </g>
  );
}

/** Панель домофона с кнопками и считывателем ключа. */
export function IntercomPanel({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect className="illustration__metal-dark" x={x} y={y} width={18} height={30} rx={3} />
      <rect className="illustration__water-soft" x={x + 3} y={y + 3} width={12} height={6} rx={1.5} />
      {[0, 1, 2].map((row) => [0, 1].map((column) => (
        <circle key={`${row}-${column}`} className="illustration__metal" cx={x + 6 + column * 6} cy={y + 14 + row * 4.5} r={1.5} />
      )))}
      <circle className="illustration__tone" cx={x + 9} cy={y + 27} r={2.2} />
    </g>
  );
}

/** Мусорный бак; full — с горкой пакетов сверху. */
export function Bin({ x, floorY, full = false }: { x: number; floorY: number; full?: boolean }) {
  return (
    <g>
      {full ? (
        <g>
          <TrashBag cx={x + 8} bottom={floorY - 32} />
          <TrashBag cx={x + 20} bottom={floorY - 33} />
          <TrashBag cx={x + 14} bottom={floorY - 41} />
        </g>
      ) : null}
      <path className="illustration__tone" d={`M${x} ${floorY - 32} H${x + 28} L${x + 25} ${floorY} H${x + 3} Z`} />
      <rect className="illustration__metal-dark" x={x - 2} y={floorY - 34} width={32} height={4} rx={2} />
      <rect className="illustration__shine" x={x + 6} y={floorY - 28} width={2} height={22} rx={1} />
    </g>
  );
}

/** Мусорный мешок с завязкой; низ — на bottom. */
export function TrashBag({ cx, bottom }: { cx: number; bottom: number }) {
  return (
    <g>
      <path className="illustration__metal-dark" d={`M${cx - 7} ${bottom} Q${cx - 8} ${bottom - 9} ${cx - 3} ${bottom - 11} H${cx + 3} Q${cx + 8} ${bottom - 9} ${cx + 7} ${bottom} Z`} />
      <path className="illustration__metal-dark" d={`M${cx - 3} ${bottom - 11} L${cx - 4} ${bottom - 15} L${cx} ${bottom - 12} L${cx + 4} ${bottom - 15} L${cx + 3} ${bottom - 11} Z`} />
      <rect className="illustration__shine" x={cx - 4} y={bottom - 8} width={1.5} height={5} rx={0.75} />
    </g>
  );
}

/** Мелкий мусор: скомканные бумажки и бутылка. */
export function Litter({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle className="illustration__surface" cx={x} cy={y} r={3.5} />
      <circle className="illustration__slab" cx={x + 9} cy={y + 1} r={3} />
      <rect className="illustration__water-soft" x={x + 15} y={y - 1} width={10} height={4} rx={2} transform={`rotate(-12 ${x + 20} ${y + 1})`} />
    </g>
  );
}
