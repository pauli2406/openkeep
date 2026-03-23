import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, Orbit, ScanSearch } from "lucide-react";
import type { DocumentsProjectionResponse } from "@openkeep/types";
import type { GalaxyColorBy } from "@/lib/explorer";
import { colorForValue } from "@/lib/explorer";
import { Button } from "@/components/ui/button";

type GalaxyCanvasProps = {
  projection: DocumentsProjectionResponse;
  colorBy: GalaxyColorBy;
  onColorByChange: (value: GalaxyColorBy) => void;
  onOpenDocument: (documentId: string) => void;
};

type Viewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type HoverState = {
  documentId: string;
  clientX: number;
  clientY: number;
};

const COLOR_OPTIONS: GalaxyColorBy[] = ["correspondent", "type", "status", "year"];

export function GalaxyCanvas({
  projection,
  colorBy,
  onColorByChange,
  onOpenDocument,
}: GalaxyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [lasso, setLasso] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  const pointMap = useMemo(
    () => new Map(projection.points.map((point) => [point.documentId, point])),
    [projection.points],
  );
  const hoveredPoint = hover ? pointMap.get(hover.documentId) ?? null : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    context.fillStyle = "rgba(15, 16, 20, 0.03)";
    for (let index = 0; index < 32; index += 1) {
      context.beginPath();
      context.arc(
        (index * 97) % rect.width,
        (index * 61) % rect.height,
        1.1,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    for (const cluster of projection.clusters.slice(0, 12)) {
      const x = projectX(cluster.centroidX, rect.width, viewport);
      const y = projectY(cluster.centroidY, rect.height, viewport);
      context.fillStyle = "rgba(15, 16, 20, 0.38)";
      context.font = "500 12px var(--font-sans)";
      context.fillText(cluster.label, x + 10, y - 8);
    }

    for (const point of projection.points) {
      const x = projectX(point.x, rect.width, viewport);
      const y = projectY(point.y, rect.height, viewport);
      const color = colorForProjectionPoint(point, colorBy);
      const isSelected = selection.includes(point.documentId);
      const isHovered = hoveredPoint?.documentId === point.documentId;
      const radius = isHovered ? 7 : isSelected ? 5 : 3.4;

      context.beginPath();
      context.fillStyle = color;
      context.globalAlpha = isSelected ? 0.98 : 0.86;
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();

      if (isHovered || isSelected) {
        context.globalAlpha = 1;
        context.strokeStyle = "rgba(27, 22, 16, 0.85)";
        context.lineWidth = isHovered ? 2.5 : 1.5;
        context.beginPath();
        context.arc(x, y, radius + 4, 0, Math.PI * 2);
        context.stroke();
      }
    }

    if (lasso) {
      const { startX, startY, endX, endY } = lasso;
      context.globalAlpha = 1;
      context.fillStyle = "rgba(56, 84, 165, 0.12)";
      context.strokeStyle = "rgba(56, 84, 165, 0.65)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.rect(
        Math.min(startX, endX),
        Math.min(startY, endY),
        Math.abs(endX - startX),
        Math.abs(endY - startY),
      );
      context.fill();
      context.stroke();
    }
  }, [colorBy, hoveredPoint, lasso, projection, selection, viewport]);

  function findNearestPoint(clientX: number, clientY: number) {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    let best: { documentId: string; distance: number } | null = null;
    for (const point of projection.points) {
      const x = projectX(point.x, rect.width, viewport);
      const y = projectY(point.y, rect.height, viewport);
      const distance = Math.hypot(x - localX, y - localY);
      if (distance > 14) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = { documentId: point.documentId, distance };
      }
    }

    return best?.documentId ?? null;
  }

  function updateSelection(nextLasso: NonNullable<typeof lasso>) {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const left = Math.min(nextLasso.startX, nextLasso.endX);
    const right = Math.max(nextLasso.startX, nextLasso.endX);
    const top = Math.min(nextLasso.startY, nextLasso.endY);
    const bottom = Math.max(nextLasso.startY, nextLasso.endY);

    setSelection(
      projection.points
        .filter((point) => {
          const x = projectX(point.x, rect.width, viewport);
          const y = projectY(point.y, rect.height, viewport);
          return x >= left && x <= right && y >= top && y <= bottom;
        })
        .map((point) => point.documentId),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {COLOR_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onColorByChange(option)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                colorBy === option
                  ? "border-[color:var(--explorer-cobalt)] bg-[color:var(--explorer-cobalt-soft)] text-[color:var(--explorer-cobalt)]"
                  : "border-[color:var(--explorer-border)] text-[color:var(--explorer-muted)]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-[color:var(--explorer-muted)]">
          <Orbit className="h-4 w-4" />
          {projection.points.length} plotted
          {selection.length > 0 ? ` · ${selection.length} selected` : ""}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[620px] overflow-hidden rounded-[2rem] border border-[color:var(--explorer-border)] bg-[radial-gradient(circle_at_20%_20%,rgba(56,84,165,0.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(183,72,23,0.1),transparent_30%),linear-gradient(180deg,rgba(255,252,246,0.95),rgba(247,241,231,0.96))]"
        onWheel={(event) => {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.08 : 0.08;
          setViewport((current) => ({
            ...current,
            scale: Math.max(0.7, Math.min(2.4, current.scale + delta)),
          }));
        }}
        onPointerDown={(event) => {
          const container = containerRef.current;
          if (!container) {
            return;
          }
          const rect = container.getBoundingClientRect();
          setLasso({
            startX: event.clientX - rect.left,
            startY: event.clientY - rect.top,
            endX: event.clientX - rect.left,
            endY: event.clientY - rect.top,
          });
        }}
        onPointerMove={(event) => {
          const nearest = findNearestPoint(event.clientX, event.clientY);
          setHover(
            nearest
              ? {
                  documentId: nearest,
                  clientX: event.clientX,
                  clientY: event.clientY,
                }
              : null,
          );

          if (lasso && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const nextLasso = {
              ...lasso,
              endX: event.clientX - rect.left,
              endY: event.clientY - rect.top,
            };
            setLasso(nextLasso);
            updateSelection(nextLasso);
          }
        }}
        onPointerUp={(event) => {
          if (lasso) {
            const isClick =
              Math.abs(lasso.startX - lasso.endX) < 6 &&
              Math.abs(lasso.startY - lasso.endY) < 6;
            if (isClick) {
              const nearest = findNearestPoint(event.clientX, event.clientY);
              if (nearest) {
                onOpenDocument(nearest);
              } else {
                setSelection([]);
              }
            }
          }
          setLasso(null);
        }}
        onPointerLeave={() => {
          setHover(null);
          setLasso(null);
        }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--explorer-muted)] backdrop-blur">
          <ScanSearch className="h-3.5 w-3.5" />
          Drag to lasso · scroll to zoom
        </div>
        <div className="absolute right-5 top-5">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-white/80 bg-white/70 backdrop-blur"
            onClick={() =>
              setViewport({
                scale: 1,
                offsetX: 0,
                offsetY: 0,
              })
            }
          >
            <Expand className="h-3.5 w-3.5" />
            Reset view
          </Button>
        </div>
        {hoveredPoint ? (
          <div className="absolute bottom-5 left-5 max-w-sm rounded-[1.4rem] border border-[color:var(--explorer-border)] bg-white/90 px-4 py-3 shadow-[0_18px_60px_rgba(25,23,18,0.16)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
              {hoveredPoint.typeName ?? "Document"}
            </p>
            <p className="mt-1 text-base font-semibold text-[color:var(--explorer-ink)]">
              {hoveredPoint.title}
            </p>
            <p className="mt-1 text-sm text-[color:var(--explorer-muted)]">
              {hoveredPoint.correspondentName ?? "Unfiled"}
              {hoveredPoint.issueDate ? ` · ${hoveredPoint.issueDate}` : ""}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function projectX(value: number, width: number, viewport: Viewport) {
  return width * 0.12 + value * width * 0.76 * viewport.scale + viewport.offsetX;
}

function projectY(value: number, height: number, viewport: Viewport) {
  return height * 0.12 + value * height * 0.76 * viewport.scale + viewport.offsetY;
}

function colorForProjectionPoint(
  point: DocumentsProjectionResponse["points"][number],
  colorBy: GalaxyColorBy,
) {
  switch (colorBy) {
    case "type":
      return colorForValue(point.typeName ?? "Unfiled");
    case "status":
      return colorForValue(point.status);
    case "year":
      return colorForValue(String(point.year ?? "unknown"));
    default:
      return colorForValue(point.correspondentName ?? "Unknown");
  }
}
