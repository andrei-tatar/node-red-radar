import { Point } from "../common/types";

export function distancePointToLine(a: Point, p1: Point, p2: Point) {
  const A = a.x;
  const B = a.y;
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;

  const numerator = Math.abs((x2 - x1) * (y1 - B) - (x1 - A) * (y2 - y1));
  const denominator = Math.hypot(x2 - x1, y2 - y1); // sqrt(dx^2 + dy^2)

  return numerator / denominator;
}

export function getSvgCoords(element: SVGGraphicsElement, p: Point) {
  let svgRoot: SVGSVGElement = element as any;
  while (svgRoot.tagName !== "svg") {
    svgRoot = svgRoot.parentElement as any;
  }

  const ctm = element.getScreenCTM()!;
  const pt = svgRoot.createSVGPoint();
  pt.x = p.x;
  pt.y = p.y;
  const result = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(result.x), y: Math.round(result.y) };
}

export function makeDraggable(
  element: SVGGraphicsElement,
  handlers: {
    dragStart?: () => void;
    dragHandler?: (opts: { point: Point; delta: Point }) => void;
    dragEnd?: () => void;
  }
) {
  element.style.cursor = "grab";

  let svgRoot: SVGSVGElement = element as any;
  while (svgRoot.tagName !== "svg") {
    svgRoot = svgRoot.parentElement as any;
  }

  const getSvgCoords = (ev: MouseEvent) => {
    const ctm = element.getScreenCTM()!;
    const pt = svgRoot.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const result = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(result.x), y: Math.round(result.y) };
  };

  let mouseDown = false;

  let initial: Point;
  const mouseDownHandler = (ev: MouseEvent) => {
    if (ev.target === element) {
      mouseDown = true;
      handlers.dragStart?.();

      const point = getSvgCoords(ev);
      initial = point;
      handlers.dragHandler?.({
        point,
        delta: { x: point.x - initial.x, y: point.y - initial.y },
      });
    }
  };

  const mouseMoveHandler = (ev: MouseEvent) => {
    if (!mouseDown) {
      return;
    }
    const point = getSvgCoords(ev);
    handlers.dragHandler?.({
      point,
      delta: { x: point.x - initial.x, y: point.y - initial.y },
    });
  };

  const mouseUpHandler = () => {
    if (mouseDown) {
      mouseDown = false;
      handlers.dragEnd?.();
    }
  };

  svgRoot.addEventListener("mousedown", mouseDownHandler);
  svgRoot.addEventListener("mousemove", mouseMoveHandler);
  svgRoot.addEventListener("mouseup", mouseUpHandler);

  return () => {
    svgRoot.removeEventListener("mousedown", mouseDownHandler);
    svgRoot.removeEventListener("mousemove", mouseMoveHandler);
    svgRoot.removeEventListener("mouseup", mouseUpHandler);
  };
}
