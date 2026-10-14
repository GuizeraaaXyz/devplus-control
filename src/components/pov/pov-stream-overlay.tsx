import i18n from "@/lib/i18n.ts";
import { useEffect, useState } from "react";
import type { PovStreamMetrics } from "@/lib/pov-stream-metrics";

export function PovStreamOverlay({ metrics }: { metrics: PovStreamMetrics }) {
  const [stats, setStats] = useState<ReturnType<
    PovStreamMetrics["sample"]
  > | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setStats(metrics.sample()), 1000);
    return () => clearInterval(timer);
  }, [metrics]);

  return (
    <div
      className="pointer-events-none absolute top-2 right-2 z-10 rounded bg-black/80 px-2 py-1.5 font-mono text-2xs leading-4 text-white tabular-nums"
      aria-hidden="true"
    >
      <div>{stats?.format ?? i18n.t("common:customUi.streamMetrics")}</div>
      {stats && (
        <>
          <div>
            FPS {stats.drawnFps.toFixed(1)}
            {i18n.t("common:customUi.jsxdrawn")} {stats.receivedFps.toFixed(1)}
            {i18n.t("common:customUi.jsxreceived")}
          </div>
          <div>
            {i18n.t("common:customUi.jsxVideo")}
            {stats.mbps.toFixed(2)} Mbit/s · {stats.frameKiB.toFixed(1)}{" "}
            KiB/frame
          </div>
          <div>
            {i18n.t("common:customUi.jsxTarget")}
            {stats.targetMbps.toFixed(2)}
            {i18n.t("common:customUi.jsxMbitsReceivedraw")}{" "}
            {stats.receiveToDrawMs?.toFixed(1) ?? "–"} ms
          </div>
          <div>
            {i18n.t("common:customUi.jsxDecoder")}
            {stats.queued ?? 0}
            {i18n.t("common:customUi.jsxqueued")}
            {stats.pending ?? 0}
            {i18n.t("common:customUi.jsxpending")}
            {stats.waitingForKey ? i18n.t("common:customUi.streamWaiting") : ""}
          </div>
          <div>
            {i18n.t("common:customUi.jsxKeyframes")}
            {stats.keyframes.toFixed(1)}
            {i18n.t("common:customUi.jsxsLastframe")}{" "}
            {stats.frameAgeMs?.toFixed(0) ?? "–"}
            {i18n.t("common:customUi.jsxmsago")}
          </div>
        </>
      )}
    </div>
  );
}
