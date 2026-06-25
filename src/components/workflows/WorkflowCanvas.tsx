import { useState, useCallback, useRef, useEffect } from "react";
import { WorkflowNode, WorkflowNodeData } from "./WorkflowNode";
import { WorkflowSidebar } from "./WorkflowSidebar";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { cn } from "@/lib/utils";

export interface EdgeData {
  id: string;
  from: string;
  to: string;
}

interface Props {
  nodes: WorkflowNodeData[];
  edges: EdgeData[];
  onChange: (nodes: WorkflowNodeData[], edges: EdgeData[]) => void;
}

export function WorkflowCanvas({ nodes, edges, onChange }: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragInfo, setDragInfo] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const addNode = useCallback(
    (type: string) => {
      const newNode: WorkflowNodeData = {
        id: crypto.randomUUID(),
        type,
        x: (-offset.x + 300) / scale,
        y: (-offset.y + 200 + Math.random() * 100) / scale,
        config: {},
      };
      onChange([...nodes, newNode], edges);
    },
    [nodes, edges, onChange, offset, scale]
  );

  const updateNodeConfig = useCallback(
    (id: string, config: Record<string, any>) => {
      onChange(
        nodes.map((n) => (n.id === id ? { ...n, config } : n)),
        edges
      );
    },
    [nodes, edges, onChange]
  );

  const deleteNode = useCallback(
    (id: string) => {
      onChange(
        nodes.filter((n) => n.id !== id),
        edges.filter((e) => e.from !== id && e.to !== id)
      );
      setSelectedNode(null);
    },
    [nodes, edges, onChange]
  );

  const handleDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      setDragInfo({ id, startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y });
    },
    [nodes]
  );

  const handleConnectStart = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectFrom(id);
  }, []);

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvas) {
        setSelectedNode(null);
        setIsPanning(true);
        panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      }
    },
    [offset]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });

      if (dragInfo) {
        const dx = (e.clientX - dragInfo.startX) / scale;
        const dy = (e.clientY - dragInfo.startY) / scale;
        onChange(
          nodes.map((n) =>
            n.id === dragInfo.id ? { ...n, x: dragInfo.nodeX + dx, y: dragInfo.nodeY + dy } : n
          ),
          edges
        );
      }

      if (isPanning) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (connectFrom && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = (e.clientX - rect.left - offset.x) / scale;
        const my = (e.clientY - rect.top - offset.y) / scale;
        
        const targetNode = nodes.find(
          (n) =>
            n.id !== connectFrom &&
            mx >= n.x && mx <= n.x + 180 &&
            my >= n.y - 10 && my <= n.y + 10
        );
        if (targetNode && !edges.some((ed) => ed.from === connectFrom && ed.to === targetNode.id)) {
          onChange(nodes, [...edges, { id: crypto.randomUUID(), from: connectFrom, to: targetNode.id }]);
        }
        setConnectFrom(null);
      }
      setDragInfo(null);
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragInfo, isPanning, connectFrom, nodes, edges, onChange, scale, offset]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((s) => Math.min(2, Math.max(0.3, s + delta)));
  }, []);

  const getNodeCenter = (node: WorkflowNodeData, position: "top" | "bottom") => {
    const x = node.x + 90; // half of 180px width
    const y = position === "top" ? node.y : node.y + 75; // approximate height
    return { x, y };
  };

  const selectedNodeData = selectedNode ? nodes.find((n) => n.id === selectedNode) : null;

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <WorkflowSidebar onAddNode={addNode} />

      <div
        ref={canvasRef}
        className={cn(
          "flex-1 relative overflow-hidden cursor-grab",
          isPanning && "cursor-grabbing"
        )}
        style={{
          backgroundImage:
            `radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)`,
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${offset.x}px ${offset.y}px`,
        }}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
        data-canvas="true"
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {/* SVG Edges */}
          <svg className="absolute inset-0 pointer-events-none" style={{ width: 5000, height: 5000, overflow: "visible" }}>
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              if (!fromNode || !toNode) return null;
              const start = getNodeCenter(fromNode, "bottom");
              const end = getNodeCenter(toNode, "top");
              const midY = (start.y + end.y) / 2;
              return (
                <g key={edge.id}>
                  <path
                    d={`M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="none"
                    opacity={0.6}
                  />
                  {/* Arrow */}
                  <circle cx={end.x} cy={end.y} r={3} fill="hsl(var(--primary))" opacity={0.6} />
                </g>
              );
            })}
            {/* Drawing connection line */}
            {connectFrom && canvasRef.current && (() => {
              const fromNode = nodes.find((n) => n.id === connectFrom);
              if (!fromNode) return null;
              const start = getNodeCenter(fromNode, "bottom");
              const rect = canvasRef.current.getBoundingClientRect();
              const ex = (mousePos.x - rect.left - offset.x) / scale;
              const ey = (mousePos.y - rect.top - offset.y) / scale;
              const midY = (start.y + ey) / 2;
              return (
                <path
                  d={`M ${start.x} ${start.y} C ${start.x} ${midY}, ${ex} ${midY}, ${ex} ${ey}`}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  fill="none"
                  opacity={0.4}
                />
              );
            })()}
          </svg>

          {nodes.map((node) => (
            <WorkflowNode
              key={node.id}
              node={node}
              isSelected={selectedNode === node.id}
              onSelect={setSelectedNode}
              onDragStart={handleDragStart}
              onConnectStart={handleConnectStart}
              scale={scale}
            />
          ))}
        </div>

        {/* Zoom indicator */}
        <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-card/80 backdrop-blur rounded-md px-2 py-1 border border-border">
          {Math.round(scale * 100)}%
        </div>
      </div>

      {selectedNodeData && (
        <NodeConfigPanel
          node={selectedNodeData}
          onUpdate={updateNodeConfig}
          onDelete={deleteNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
