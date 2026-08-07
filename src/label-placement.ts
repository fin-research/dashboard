export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VerticalPreference = "top" | "bottom";

interface LabelPlacementInput {
  point: { x: number; y: number };
  label: { width: number; height: number };
  bounds: LabelRect;
  obstacles: LabelRect[];
  preferred: VerticalPreference;
  gap?: number;
}

export interface LabelPlacement extends LabelRect {
  side: "top" | "bottom" | "left" | "right";
}

export function chooseBestLabelPlacement({
  point,
  label,
  bounds,
  obstacles,
  preferred,
  gap = 14,
}: LabelPlacementInput): LabelPlacement {
  const halfWidth = label.width / 2;
  const halfHeight = label.height / 2;
  const candidates: LabelPlacement[] = [
    {
      x: point.x - halfWidth,
      y: point.y - gap - label.height,
      ...label,
      side: "top",
    },
    {
      x: point.x - halfWidth,
      y: point.y + gap,
      ...label,
      side: "bottom",
    },
    {
      x: point.x - label.width,
      y: point.y - gap - label.height,
      ...label,
      side: "top",
    },
    {
      x: point.x,
      y: point.y - gap - label.height,
      ...label,
      side: "top",
    },
    {
      x: point.x - label.width,
      y: point.y + gap,
      ...label,
      side: "bottom",
    },
    {
      x: point.x,
      y: point.y + gap,
      ...label,
      side: "bottom",
    },
    {
      x: point.x - gap - label.width,
      y: point.y - halfHeight,
      ...label,
      side: "left",
    },
    {
      x: point.x + gap,
      y: point.y - halfHeight,
      ...label,
      side: "right",
    },
  ];

  return candidates.reduce((best, candidate, index) => {
    const score = placementScore(
      candidate,
      bounds,
      obstacles,
      preferred,
      index,
    );
    return score < best.score ? { placement: candidate, score } : best;
  }, {
    placement: candidates[0]!,
    score: Number.POSITIVE_INFINITY,
  }).placement;
}

function placementScore(
  candidate: LabelPlacement,
  bounds: LabelRect,
  obstacles: LabelRect[],
  preferred: VerticalPreference,
  order: number,
): number {
  const outside =
    Math.max(0, bounds.x - candidate.x) +
    Math.max(0, bounds.y - candidate.y) +
    Math.max(
      0,
      candidate.x + candidate.width - (bounds.x + bounds.width),
    ) +
    Math.max(
      0,
      candidate.y + candidate.height - (bounds.y + bounds.height),
    );
  const overlap = obstacles.reduce(
    (sum, obstacle) => sum + overlapArea(candidate, obstacle),
    0,
  );
  const verticalPenalty =
    candidate.side === preferred
      ? 0
      : candidate.side === "left" || candidate.side === "right"
        ? 900
        : 1_800;

  return outside * 100_000 + overlap * 10_000 + verticalPenalty + order;
}

export function overlapArea(left: LabelRect, right: LabelRect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}
