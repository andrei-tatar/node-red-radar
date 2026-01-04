import { useEffect, useRef, useState } from "react";
import { Radar } from "../common/types";
import { makeDraggable } from "./draggable";
import { Subscription } from "rxjs";
import { rpc } from "./ws";
import { useObservable } from "./util";

export const RadarComponent = ({ radar }: { radar: Radar }) => {
  const moveHandle = useRef<SVGImageElement>(null);
  const rotateHandle = useRef<SVGImageElement>(null);

  const [transform, setTransform] = useState<DOMMatrix>(
    new DOMMatrix(radar.transform)
  );

  useEffect(
    () => setTransform(new DOMMatrix(radar.transform)),
    [radar.transform]
  );

  useEffect(() => {
    const transformChanged = () => {
      setTransform((t) => {
        rpc.radars
          .updateRadarTransform(radar.id, [t.a, t.b, t.c, t.d, t.e, t.f])
          .subscribe();

        return t;
      });
    };

    const cleanup = new Subscription();

    cleanup.add(
      makeDraggable(moveHandle.current!, {
        dragHandler({ point }) {
          setTransform((transform) => transform.translate(point.x, point.y));
        },
        dragEnd() {
          transformChanged();
        },
      })
    );

    cleanup.add(
      makeDraggable(rotateHandle.current!, {
        dragHandler({ point }) {
          const angle = (Math.atan2(point.y, point.x) / Math.PI) * 180 + 90;
          setTransform((transform) => transform.rotate(angle));
        },
        dragEnd() {
          transformChanged();
        },
      })
    );

    return () => cleanup.unsubscribe();
  }, []);

  const targets = useObservable(
    () => rpc.radars.radarTargets(radar.id),
    [radar.id]
  );

  return (
    <g transform={transform.toString()} fill="none">
      {/* detected targets */}
      {targets?.map((p, i) => (
        <circle
          key={i}
          r="150"
          stroke="green"
          strokeWidth={30}
          cx={p.x}
          cy={p.y}
        />
      ))}

      <g opacity="0.5">
        {/* radar */}
        <g stroke="red" strokeWidth="30">
          <circle
            r="3000"
            transform="rotate(45)"
            strokeDasharray={`${3000 * 2 * Math.PI * 0.25} ${
              3000 * 2 * Math.PI * 0.75
            }`}
          />
          <line x1="0" y1="0" x2="0" y2="5000" transform="rotate(-45)" />
          <line x1="0" y1="0" x2="0" y2="5000" transform="rotate(45)" />
        </g>

        {/* rotate handle */}
        {
          <image
            width="600"
            height="600"
            href="./rotate.svg"
            ref={rotateHandle}
            x="-300"
            y="-1300"
          />
        }

        {/* move handle */}
        <image
          width="600"
          height="600"
          href="./move.svg"
          ref={moveHandle}
          x="-300"
          y="-300"
        />
      </g>
    </g>
  );
};
