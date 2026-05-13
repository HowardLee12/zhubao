import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Renoly — 裝修小隊的接案管家：報價、排程、收款一站搞定";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800, color: "white", marginBottom: 16, letterSpacing: "-0.02em" }}>
          Renoly
        </div>
        <div style={{ fontSize: 36, color: "rgba(255,255,255,0.85)", marginBottom: 40 }}>
          裝修小隊的接案管家
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 28, color: "rgba(255,255,255,0.7)" }}>
            報價單 · 工班排程 · 收款追蹤 · 施工照片
          </div>
          <div style={{ fontSize: 28, color: "rgba(255,255,255,0.7)" }}>
            雙版本報價：成本版 + 報客版，自動計算利潤
          </div>
        </div>
        <div
          style={{
            marginTop: 48,
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              padding: "12px 32px",
              borderRadius: 24,
              background: "rgba(255,255,255,0.2)",
              color: "white",
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            免費試用
          </div>
          <div style={{ fontSize: 22, color: "rgba(255,255,255,0.5)" }}>
            zhubao.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
