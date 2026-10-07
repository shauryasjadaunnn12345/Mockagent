import { ImageResponse } from "next/og";

export const alt =
  "MockAgent — test AI agent tool calls before connecting real services";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "#f3f7f3",
          color: "#142c25",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "#143d31",
              color: "#dfff8b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "36px",
              fontWeight: 700,
            }}
          >
            M
          </div>
          <span style={{ fontSize: "30px", fontWeight: 700 }}>MockAgent</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div
            style={{
              color: "#39705b",
              fontSize: "22px",
              fontWeight: 700,
              letterSpacing: "2px",
            }}
          >
            AI AGENT TOOL TESTING
          </div>
          <div
            style={{
              maxWidth: "1000px",
              fontSize: "64px",
              lineHeight: 1.12,
              fontWeight: 700,
            }}
          >
            Test tool calls before production.
          </div>
          <div style={{ color: "#51645a", fontSize: "26px" }}>
            Mock endpoints · JSON Schema validation · execution logs
          </div>
        </div>
        <div style={{ color: "#39705b", fontSize: "20px" }}>
          mockagent.online
        </div>
      </div>
    ),
    size
  );
}
