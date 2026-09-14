// ~33m grid cell used to group reports about the same physical issue.
const CELL = 0.0003;

export function geoCell(lat: number, lng: number): string {
  return `${Math.round(lat / CELL)}:${Math.round(lng / CELL)}`;
}

export function neighbourCells(lat: number, lng: number): string[] {
  const y = Math.round(lat / CELL);
  const x = Math.round(lng / CELL);
  const cells: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) cells.push(`${y + dy}:${x + dx}`);
  }
  return cells;
}

export const CATEGORY_LABELS: Record<string, string> = {
  pothole: "Pothole",
  garbage: "Garbage dump",
  water_leak: "Water leak",
  other: "Other issue",
};

export const STATUS_LABELS: Record<string, string> = {
  reported: "Reported",
  in_progress: "In progress",
  resolved: "Resolved",
};
