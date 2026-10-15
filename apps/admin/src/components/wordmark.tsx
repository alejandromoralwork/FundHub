export function Wordmark({ light = false, suffix = "Admin" }: { light?: boolean; suffix?: string }) {
  return (
    <span style={{ fontWeight: 700, letterSpacing: -0.5, fontSize: 20, color: light ? "#fff" : "#1e2632", whiteSpace: "nowrap" }}>
      Fund<span style={{ color: "#0f9d78" }}>Hub</span>
      {suffix && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 }}>{suffix}</span>}
    </span>
  );
}
