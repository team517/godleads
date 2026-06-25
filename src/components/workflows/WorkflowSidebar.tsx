import { NODE_TYPES, NodeCategory } from "./nodeTypes";
import { cn } from "@/lib/utils";

interface Props {
  onAddNode: (type: string) => void;
}

const categories: { key: NodeCategory; label: string; color: string }[] = [
  { key: "trigger", label: "Triggers", color: "bg-emerald-500" },
  { key: "action", label: "Acciones", color: "bg-blue-500" },
  { key: "ai", label: "Inteligencia Artificial", color: "bg-purple-500" },
];

export function WorkflowSidebar({ onAddNode }: Props) {
  return (
    <div className="w-56 border-r border-border bg-card/50 overflow-y-auto p-3 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Nodos</p>
      {categories.map((cat) => (
        <div key={cat.key} className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-1.5">
            <div className={cn("h-2 w-2 rounded-full", cat.color)} />
            <span className="text-[11px] font-semibold text-muted-foreground">{cat.label}</span>
          </div>
          {NODE_TYPES.filter((n) => n.category === cat.key).map((nt) => {
            const Icon = nt.icon;
            return (
              <button
                key={nt.type}
                onClick={() => onAddNode(nt.type)}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
              >
                <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", nt.color)}>
                  <Icon className="h-3.5 w-3.5 text-white" />
                </div>
                {nt.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
