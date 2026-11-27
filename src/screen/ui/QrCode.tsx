import { encode } from "uqr";

/** QR コードを SVG で描く。1つの path にまとめる。色は CSS の変数（--qr-dark、--qr-light） */
export function QrCode({ text }: { text: string }) {
  const { data } = encode(text, { ecc: "M", border: 2 });
  const size = data.length;
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="スマホで読む QR コード"
    >
      <rect width={size} height={size} fill="var(--qr-light)" />
      <path d={path} fill="var(--qr-dark)" />
    </svg>
  );
}
