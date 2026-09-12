import { memo } from "react";
import { cn } from "@/lib/utils";
import { getNodeType } from "./nodeTypes";

export interface WorkflowNodeData {
  id: string;
  type: string;
  x: number;
  y: number;
  config: Record<string, any>;
}

interface Props {
  node: WorkflowNodeData;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onConnectStart: (id: string, e: React.MouseEvent) => void;
  scale: number;
}

function WorkflowNodeComponent({ node, isSelected, onSelect, onDragStart, onConnectStart, scale }: Props) {
  const def = getNodeType(node.type);

  if (!def) return null;

  const Icon = def.icon;

  return (
    <div
      className={cn(
        "absolute select-none cursor-grab active:cursor-grabbing",
        "rounded-lg border bg-card shadow-rest transition-shadow w-[180px]",
        // `shadow-primary` colisiona con el color `primary` en tailwind.config y sale sin sombra,
        // así que la selección usa la sombra elevada del diseño + el borde violeta.
        isSelected ? "border-primary shadow-raised" : "border-border hover:border-primary/40"
      )}
      style={{ left: node.x, top: node.y }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect(node.id);
        onDragStart(node.id, e);
      }}
    >
      {def.category !== "trigger" && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-border bg-background hover:border-primary transition-colors z-10" />
      )}
      <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded-t-[5px]", def.color)}>
        <Icon className="h-4 w-4 text-white shrink-0" />
        <span className="text-[13px] font-semibold text-white truncate">{def.label}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[11px] text-muted-foreground leading-tight">{def.description}</p>
      </div>
      <div
        className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-border bg-primary hover:scale-125 transition-transform cursor-crosshair z-10"
        onMouseDown={(e) => {
          e.stopPropagation();
          onConnectStart(node.id, e);
        }}
      />
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
