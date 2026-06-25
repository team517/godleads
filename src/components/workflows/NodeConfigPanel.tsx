import { X } from "lucide-react";
import { getNodeType } from "./nodeTypes";
import { WorkflowNodeData } from "./WorkflowNode";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Props {
  node: WorkflowNodeData;
  onUpdate: (id: string, config: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function NodeConfigPanel({ node, onUpdate, onDelete, onClose }: Props) {
  const def = getNodeType(node.type);
  if (!def) return null;

  const Icon = def.icon;

  const handleChange = (key: string, value: any) => {
    onUpdate(node.id, { ...node.config, [key]: value });
  };

  return (
    <div className="w-72 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-md ${def.color}`}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold">{def.label}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-4">
        <p className="text-xs text-muted-foreground">{def.description}</p>

        {def.configFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-xs">{field.label}</Label>
            {field.type === "text" && (
              <Input
                value={node.config[field.key] || field.defaultValue || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="text-xs h-8"
              />
            )}
            {field.type === "number" && (
              <Input
                type="number"
                value={node.config[field.key] ?? field.defaultValue ?? ""}
                onChange={(e) => handleChange(field.key, Number(e.target.value))}
                placeholder={field.placeholder}
                className="text-xs h-8"
              />
            )}
            {field.type === "textarea" && (
              <Textarea
                value={node.config[field.key] || field.defaultValue || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="text-xs min-h-[80px]"
              />
            )}
            {field.type === "select" && field.options && (
              <Select
                value={node.config[field.key] || field.options[0]?.value || ""}
                onValueChange={(v) => handleChange(field.key, v)}
              >
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ))}

        <div className="pt-3 border-t border-border">
          <Button variant="destructive" size="sm" className="w-full text-xs" onClick={() => onDelete(node.id)}>
            Eliminar nodo
          </Button>
        </div>
      </div>
    </div>
  );
}
