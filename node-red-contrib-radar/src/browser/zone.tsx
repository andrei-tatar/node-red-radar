import { useEffect, useRef, useState } from "react";
import { Point, Zone } from "../common/types";
import { distancePointToLine, getSvgCoords, makeDraggable } from "./draggable";

export function ZoneComponent({
  zone,
  readonly,
  zoneUpdated,
}: {
  zone: Zone;
  readonly: boolean;
  zoneUpdated: (newZone: Zone) => void;
}) {
  const moveHandle = useRef<SVGPolygonElement>(null);
  const [points, setPoints] = useState(zone.points);
  // follow changes from the server (another tab, a file edit, a reconnect)
  useEffect(() => setPoints(zone.points), [zone.points]);

  const zoneRef = useRef(zone);
  zoneRef.current = zone;

  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (readonly) {
      return;
    }

    if (moveHandle.current) {
      return makeDraggable(moveHandle.current, {
        dragHandler({ delta }) {
          setPoints(
            zoneRef.current.points.map((i) => ({
              x: i.x + delta.x,
              y: i.y + delta.y,
            }))
          );
        },
        dragEnd() {
          zoneUpdated({
            id: zoneRef.current.id,
            points: pointsRef.current,
          });
        },
      });
    }
  }, [readonly]);

  return (
    <>
      <polygon
        stroke="none"
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        ref={moveHandle}
      >
        <title>{zone.id}</title>
      </polygon>

      {!readonly && (
        <>
          <polygon
            fill="none"
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            style={{ cursor: "cell" }}
            strokeWidth={100}
            onClick={(ev) => {
              const pt = getSvgCoords(ev.target as SVGPolygonElement, {
                x: ev.clientX,
                y: ev.clientY,
              });

              let minDist = Infinity,
                index = -1;

              for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[i === points.length - 1 ? 0 : i + 1];
                const dist = distancePointToLine(pt, p1, p2);
                if (dist < minDist) {
                  minDist = dist;
                  index = i;
                }
              }

              if (index !== -1) {
                index = (index + 1) % points.length;
                setPoints((points) => {
                  const newPoints = [...points];
                  newPoints.splice(index, 0, pt);

                  zoneUpdated({
                    id: zoneRef.current.id,
                    points: newPoints,
                  });

                  return newPoints;
                });
              }
            }}
          />

          {points.map((point, pointIndex) => (
            <ZonePoint
              point={point}
              key={pointIndex}
              pointMoved={(newPoint) => {
                setPoints((points) => {
                  return points.map((oldPoint, index) =>
                    index === pointIndex ? newPoint : oldPoint
                  );
                });
              }}
              moveEnd={() => {
                zoneUpdated({
                  id: zone.id,
                  points: pointsRef.current,
                });
              }}
            />
          ))}
        </>
      )}
    </>
  );
}

function ZonePoint({
  point,
  pointMoved,
  moveEnd,
}: {
  point: Point;
  pointMoved: (p: Point) => void;
  moveEnd: () => void;
}) {
  const moveHandle = useRef<SVGRectElement>(null);
  useEffect(() => {
    return makeDraggable(moveHandle.current!, {
      dragHandler({ point }) {
        pointMoved(point);
      },
      dragEnd() {
        moveEnd();
      },
    });
  }, []);
  return (
    <rect
      fillOpacity={1}
      x={point.x - 50}
      y={point.y - 50}
      width={100}
      height={100}
      ref={moveHandle}
      className="polygon-drag-handle"
    />
  );
}
