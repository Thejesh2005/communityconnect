import { useEffect, useRef } from "react";

type Props = {
  lat: number;
  lng: number;
  draggable?: boolean;
  onChange?: (lat: number, lng: number) => void;
  className?: string;
};

/**
 * Leaflet is browser-only, so it is imported lazily after mount.
 */
export function MapPicker({ lat, lng, draggable = false, onChange, className }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !holder.current) return;

      const map = L.map(holder.current, {
        center: [lat, lng],
        zoom: 18,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:50%;background:var(--primary);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = L.marker([lat, lng], { draggable, icon }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onChangeRef.current?.(p.lat, p.lng);
      });
      if (draggable) {
        map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
          marker.setLatLng(e.latlng);
          onChangeRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      }

      mapRef.current = map;
      markerRef.current = marker;
      setTimeout(() => map.invalidateSize(), 120);
      cleanup = () => map.remove();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggable]);

  useEffect(() => {
    const marker = markerRef.current as { setLatLng: (p: [number, number]) => void } | null;
    marker?.setLatLng([lat, lng]);
  }, [lat, lng]);

  return <div ref={holder} className={className} aria-label="Map showing the report location" />;
}
