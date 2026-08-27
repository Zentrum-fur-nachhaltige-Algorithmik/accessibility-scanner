/**
 * Conformity seal shown in the letterhead and next to the score.
 *
 * Braille motif (a braille "equals" sign: equality doubles as
 * conformity) inside concentric rings and a milled tick ring.
 *
 * The seal is pure geometry and carries no text node. axe-core cannot
 * determine a background colour for <text>/<textPath> inside an SVG and
 * reports "incomplete" for it, so the legend and the verdict are set as real
 * HTML text beside the seal (see .pb-seal-legend / .pb-verdict-label), where
 * they are selectable, zoomable, translatable and contrast-checkable.
 *
 * Two sizes share the drawing: a small decorative mark in the letterhead and
 * the large stamp next to the score.
 */

// Braille cell geometry: cell 1 carries dots 4 and 6, cell 2 carries dots 1 and 3.
const CELL_COLUMNS = [69, 87.6, 112.4, 131];
const CELL_ROWS = [-18.6, 0, 18.6];
const FILLED = new Set(['87.6/-18.6', '87.6/18.6', '112.4/-18.6', '112.4/18.6']);

const TICK_COUNT = 36;
const TICK_INNER = 74;
const TICK_OUTER = 84;

function BrailleMotif({ centerY }) {
  const dots = [];
  for (const cx of CELL_COLUMNS) {
    for (const dy of CELL_ROWS) {
      dots.push(
        <circle
          key={`${cx}-${dy}`}
          cx={cx}
          cy={centerY + dy}
          r="6.2"
          fill={FILLED.has(`${cx}/${dy}`) ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
        />
      );
    }
  }
  return <g>{dots}</g>;
}

function MilledRing() {
  const ticks = [];
  for (let i = 0; i < TICK_COUNT; i += 1) {
    const angle = (i / TICK_COUNT) * Math.PI * 2;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    ticks.push(
      <line
        key={i}
        x1={(100 + TICK_INNER * sin).toFixed(2)}
        y1={(100 - TICK_INNER * cos).toFixed(2)}
        x2={(100 + TICK_OUTER * sin).toFixed(2)}
        y2={(100 - TICK_OUTER * cos).toFixed(2)}
        stroke="currentColor"
        strokeWidth="1.2"
      />
    );
  }
  return <g>{ticks}</g>;
}

export default function ConformitySeal({ size = 104, label = null }) {
  // Decorative unless it is given a label: the letterhead mark sits next to
  // the app name and would only repeat it.
  const semantics = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true' };

  return (
    <svg
      className="pb-seal"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      focusable="false"
      {...semantics}
    >
      <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="1" />
      <MilledRing />
      <circle cx="100" cy="100" r="66" fill="none" stroke="currentColor" strokeWidth="1" />
      <BrailleMotif centerY={100} />
    </svg>
  );
}
