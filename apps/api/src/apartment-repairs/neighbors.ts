export type ApartmentGridCell = {
  apartmentId: string;
  entrance: number | null;
  floor: number | null;
  column: number | null;
};

export function neighboringApartmentIds(cells: ApartmentGridCell[], apartmentId: string): string[] {
  const target = cells.find((cell) => cell.apartmentId === apartmentId);
  if (!target || target.entrance === null || target.floor === null || target.column === null) return [];
  const { entrance, floor, column } = target;

  return cells.flatMap((cell) => {
    if (cell.apartmentId === apartmentId || cell.entrance !== entrance
      || cell.floor === null || cell.column === null) return [];
    const horizontal = cell.floor === floor && Math.abs(cell.column - column) === 1;
    const vertical = cell.column === column && Math.abs(cell.floor - floor) === 1;
    return horizontal || vertical ? [cell.apartmentId] : [];
  });
}
