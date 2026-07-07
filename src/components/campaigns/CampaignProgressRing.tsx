/** Small circular progress ring for a campaign card: shows how far the campaign has
 *  gone = leads already emailed / total leads, with the % in the centre. */
interface Props {
  sent: number;   // leads that have received at least one email (last_sent_at set)
  total: number;  // total leads in the campaign
  size?: number;
}

export default function CampaignProgressRing({ sent, total, size = 46 }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const done = pct >= 100;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={total > 0 ? `${sent} de ${total} leads enviados (${pct}%)` : "Sin leads asignados"}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? "hsl(142 71% 45%)" : "hsl(var(--primary))"}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`text-[11px] font-bold ${done ? "text-emerald-600" : "text-foreground"}`}>{pct}%</span>
      </div>
    </div>
  );
}
