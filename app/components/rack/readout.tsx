import { useEffect, useRef, useState } from "react";
import type { Readout as ReadoutSpec } from "../../rack";
import type { ReadoutValue } from "../../rack/renderer";
import { subscribeReadout } from "../../sandbox/readouts";

const height = 56;
// The quietest level a meter or spectrum shows, in dB.
const floor = -100;

// What a readout rack's node shows, drawn as it arrives from the sandbox.
// Values skip React: each one is drawn straight onto the canvas, and only the
// number beside a level or a value re-renders.
export function Readout({
  rackId,
  kind,
}: {
  readonly rackId: string;
  readonly kind: ReadoutSpec["kind"];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [number, setNumber] = useState<number | undefined>(undefined);
  const showsNumber = kind === "level" || kind === "dc";

  useEffect(() => {
    let frame = 0;
    let latest: ReadoutValue | undefined;
    let peak = floor;
    let range = 1;
    const draw = () => {
      frame = 0;
      const element = canvas.current;
      const context = element?.getContext("2d");
      if (element === null || !context || latest === undefined) return;
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      if (element.width !== Math.round(width * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const ink = getComputedStyle(element).color;
      context.fillStyle = ink;
      context.strokeStyle = ink;
      context.lineWidth = 1.5;

      if (typeof latest === "number") {
        if (kind === "level") {
          // A peak falls slowly, so a hit stays visible for a moment.
          const level = Math.max(latest, floor);
          peak = Math.max(level, peak - 0.5);
          const at = (db: number) => ((db - floor) / -floor) * width;
          context.globalAlpha = 0.2;
          context.fillRect(0, height / 2 - 6, width, 12);
          context.globalAlpha = 1;
          context.fillRect(0, height / 2 - 6, at(level), 12);
          context.fillRect(at(peak) - 1, height / 2 - 9, 2, 18);
        } else {
          // A value's scale grows to fit the largest it has seen.
          range = Math.max(range, Math.abs(latest));
          const middle = width / 2;
          const to = middle + (latest / range) * middle;
          context.globalAlpha = 0.2;
          context.fillRect(0, height / 2 - 6, width, 12);
          context.globalAlpha = 1;
          context.fillRect(
            Math.min(middle, to),
            height / 2 - 6,
            Math.abs(to - middle),
            12,
          );
          context.fillRect(middle - 0.5, height / 2 - 9, 1, 18);
        }
        return;
      }

      const values = latest;
      context.beginPath();
      values.forEach((value, index) => {
        const x =
          kind === "spectrum"
            ? // Pitch is heard on a log scale, so the bins are spread that way.
              (Math.log(index + 1) / Math.log(values.length)) * width
            : (index / (values.length - 1)) * width;
        const y =
          kind === "spectrum"
            ? (Math.max(value, floor) / floor) * height
            : height / 2 - value * (height / 2 - 2);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };

    const stop = subscribeReadout(rackId, (value) => {
      latest = value;
      if (typeof value === "number") setNumber(value);
      if (frame === 0) frame = requestAnimationFrame(draw);
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [rackId, kind]);

  const label =
    kind === "level"
      ? "Level meter"
      : kind === "dc"
        ? "Signal value"
        : kind === "spectrum"
          ? "Spectrum"
          : "Waveform";

  return (
    <div className="flex items-center gap-2 px-3 py-2" data-testid="readout">
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        style={{ height }}
        className="min-w-0 flex-1 text-foreground"
      />
      {showsNumber ? (
        <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {number === undefined
            ? "–"
            : kind === "level"
              ? `${Math.max(number, floor).toFixed(1)} dB`
              : number.toFixed(3)}
        </span>
      ) : null}
    </div>
  );
}
