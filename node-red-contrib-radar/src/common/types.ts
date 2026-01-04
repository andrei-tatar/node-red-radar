export type Radar = {
  id: string;
  transform: number[];
};

export type Zone = {
  id: string;
  points: Point[];
};

export type Point = {
  x: number;
  y: number;
};
