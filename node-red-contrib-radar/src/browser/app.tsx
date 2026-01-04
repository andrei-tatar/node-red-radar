import { RadarComponent } from "./radar";
import { EMPTY } from "rxjs";
import { ZoneComponent } from "./zone";
import { useRef, useState } from "react";
import { Zone } from "../common/types";
import { rpc } from "./ws";
import { useObservable } from "./util";

export function App({ readonly }: { readonly: boolean }) {
  const radars = useObservable(rpc.radars.all);
  const points = useObservable(readonly ? rpc.points : EMPTY, [readonly]);
  const zones = useObservable(rpc.zones.all);
  const activatedZones = useObservable(rpc.zones.activeZoneIds, []);
  const [showModal, setShowModal] = useState(false);

  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const zoneUpdated = (newZone: Zone) => {
    const newZones = (zonesRef.current ?? []).map((oldZone) =>
      oldZone.id === newZone.id ? newZone : oldZone
    );
    rpc.zones.update(newZones).subscribe();
  };

  return (
    <div>
      <svg viewBox="-8200,-4000,19500,14200">
        {/* house */}
        <g stroke="red" strokeWidth="10px" fill="grey">
          <path d="M -8013.84 -3928.9L -7143.84 -3928.9L -7143.84 -3458.9L -7543.84 -3458.9L -7543.84 2551.1L -3043.84 2551.1L -3043.84 2751.1L -5693.84 2751.1L -5693.84 3501.1L -6163.84 3501.1L -6163.84 3021.1L -8013.84 3021.1z" />
          <path d="M 4706.16 341.103L 4706.16 541.103L 1506.16 541.103L 1506.16 341.103L 2456.16 341.103L 2456.16 -3458.9L 1506.16 -3458.9L 1506.16 -3928.9L 3456.16 -3928.9L 3456.16 -3458.9L 2656.16 -3458.9L 2656.16 341.103z" />
          <path d="M -2243.84 2751.1L -2243.84 2551.1L -1543.84 2551.1L-1543.84 2491.1L-1343.84 2491.1L-1343.84 5251.1L-5693.84 5251.1L-5693.84 7651.1L-6163.84 7651.1L -6163.84 4301.1L -5693.84 4301.1L -5693.84 5051.1L -1543.84 5051.1L -1543.84 2751.1z" />
          <path d="M -6163.84 10121.1L -5693.84 10121.1L -5693.84 9651.1L -6163.84 9651.1 Z" />
          <path d="M -1533.84 8151.1L -683.837 8151.1L -683.837 8621.1L -1063.84 8621.1L -1063.84 10121.1L -3893.84 10121.1L -3893.84 9651.1L -1533.84 9651.1 Z" />
          <path d="M 1316.16 8151.1L 3766.16 8151.1L 3766.16 8621.1L 1316.16 8621.1 Z" />
          <path d="M 3306.16 1941.1L 3306.16 1741.1L 6606.16 1741.1L 6606.16 1941.1L 6466.16 1941.1L 6466.16 2041.1L 6366.16 2041.1L 6366.16 1941.1L 3866.16 1941.1L 3866.16 3541.1L 6366.16 3541.1L 6366.16 2741.1L 6466.16 2741.1L 6466.16 8151.1L 7566.16 8151.1L 7566.16 8621.1L 5766.16 8621.1L 5766.16 8151.1L 6266.16 8151.1L 6266.16 3741.1L 456.163 3741.1L 456.163 2691.1L 656.163 2691.1L 656.163 3541.1L 1856.16 3541.1L 1856.16 1941.1L 656.163 1941.1L 656.163 1991.1L 456.163 1991.1L 456.163 1741.1L 2606.16 1741.1L 2606.16 1941.1L 1956.16 1941.1L 1956.16 3541.1L 3766.16 3541.1L 3766.16 1941.1 Z" />
          <path d="M 9556.16 -3458.9L 9556.16 -3928.9L 11136.2 -3928.9L 11136.2 1451.1L 10666.2 1451.1L 10666.2 541.103L 7856.16 541.103L 7856.16 2551.1L 7956.16 2551.1L 7956.16 2651.1L 7756.16 2651.1L 7756.16 1941.1L 7506.16 1941.1L 7506.16 1741.1L 7756.16 1741.1L 7756.16 541.103L 7506.16 541.103L 7506.16 341.103L 10666.2 341.103L 10666.2 -3458.9 Z" />
          <path d="M 706.163 341.103L 656.163 341.103L 656.163 -3458.9L 706.163 -3458.9L 706.163 -3928.9L 0 -3928.9L 0 -3458.9L 456.163 -3458.9L 456.163 541.103L 706.163 541.103 Z" />
          <path d="M -1343.84 -3458.9L -1343.84 1691.1L -1543.84 1691.1L -1543.84 -3458.9L -1943.84 -3458.9L -1943.84 -3928.9L -1100 -3928.9L -1100 -3458.9 Z" />
          <path d="M 5456.16 -3458.9L 5456.16 -3928.9L 7556.16 -3928.9L 7556.16 -3458.9L 6456.16 -3458.9L 6456.16 341.103L 6606.16 341.103L 6606.16 541.103L 5606.16 541.103L 5606.16 341.103L 6256.16 341.103L 6256.16 -3458.9 Z" />
          <path d="M 8756.16 2551.1L 10666.2 2551.1L 10666.2 2251.1L 11136.2 2251.1L 11136.2 8621.1L 9566.16 8621.1L 9566.16 8151.1L 10666.2 8151.1L 10666.2 2651.1L 8756.16 2651.1 Z" />
        </g>

        {/* zones */}
        <g fillOpacity={0.2} strokeWidth={50}>
          {zones?.map((zone, i) => (
            <g
              key={i}
              fill={activatedZones?.includes(zone.id) ? "green" : "red"}
              stroke={activatedZones?.includes(zone.id) ? "green" : "red"}
            >
              <ZoneComponent
                zone={zone}
                readonly={readonly}
                zoneUpdated={zoneUpdated}
              />
            </g>
          ))}
        </g>

        {/* radar sensors */}
        {!readonly &&
          radars?.map((r) => <RadarComponent key={r.id} radar={r} />)}

        {/* mapped points */}
        {readonly && (
          <g fill="red">
            {points?.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={150} />
            ))}
          </g>
        )}
      </svg>

      {!readonly && (
        <div style={{ marginTop: "1rem" }}>
          <button onClick={() => setShowModal(true)}>Add zone</button>
        </div>
      )}

      {/* Simple modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              padding: "1rem",
              borderRadius: 6,
              minWidth: 320,
              boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Zone id:
                <input
                  id="zone-id-input"
                  autoFocus
                  style={{ marginLeft: "0.5rem", width: "70%" }}
                />
              </label>
            </div>

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button onClick={() => setShowModal(false)}>Cancel</button>
              <button
                onClick={() => {
                  setShowModal(false);
                  const input = document.getElementById(
                    "zone-id-input"
                  )! as HTMLInputElement;
                  const zoneId = input.value;
                  const newZones = (zones ?? []).concat([
                    {
                      id: zoneId,
                      points: [
                        { x: -1000, y: -1000 },
                        { x: 1000, y: -1000 },
                        { x: 1000, y: 1000 },
                        { x: -1000, y: 1000 },
                      ],
                    },
                  ]);
                  rpc.zones.update(newZones).subscribe();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
