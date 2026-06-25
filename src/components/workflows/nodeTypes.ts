import { Mail, UserPlus, MessageSquare, Clock, Send, MoveRight, PlusCircle, Timer, Bot, Tag, FileText } from "lucide-react";

export type NodeCategory = "trigger" | "action" | "ai";

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  icon: any;
  color: string; // tailwind bg class using semantic tokens
  description: string;
  configFields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string | number;
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  // Triggers
  {
    type: "email_received",
    label: "Email recibido",
    category: "trigger",
    icon: Mail,
    color: "bg-emerald-500",
    description: "Se activa cuando llega un email nuevo",
    configFields: [
      { key: "account", label: "Cuenta email", type: "text", placeholder: "Todas las cuentas" },
    ],
  },
  {
    type: "lead_created",
    label: "Lead creado",
    category: "trigger",
    icon: UserPlus,
    color: "bg-emerald-500",
    description: "Se activa cuando se añade un lead nuevo",
    configFields: [
      { key: "list", label: "Lista específica", type: "text", placeholder: "Cualquier lista" },
    ],
  },
  {
    type: "reply_received",
    label: "Respuesta recibida",
    category: "trigger",
    icon: MessageSquare,
    color: "bg-emerald-500",
    description: "Se activa cuando un lead responde",
    configFields: [
      { key: "campaign", label: "Campaña", type: "text", placeholder: "Cualquier campaña" },
    ],
  },
  {
    type: "scheduled",
    label: "Programado",
    category: "trigger",
    icon: Clock,
    color: "bg-emerald-500",
    description: "Se activa en un horario definido",
    configFields: [
      { key: "cron", label: "Frecuencia", type: "select", options: [
        { value: "daily", label: "Diario" },
        { value: "weekly", label: "Semanal" },
        { value: "hourly", label: "Cada hora" },
      ]},
      { key: "time", label: "Hora", type: "text", placeholder: "09:00" },
    ],
  },
  // Actions
  {
    type: "create_campaign",
    label: "Crear campaña",
    category: "action",
    icon: PlusCircle,
    color: "bg-blue-500",
    description: "Crea una campaña automáticamente",
    configFields: [
      { key: "name", label: "Nombre campaña", type: "text", placeholder: "Campaña automática" },
      { key: "daily_limit", label: "Límite diario", type: "number", defaultValue: 50 },
    ],
  },
  {
    type: "send_email",
    label: "Enviar email",
    category: "action",
    icon: Send,
    color: "bg-blue-500",
    description: "Envía un email específico",
    configFields: [
      { key: "subject", label: "Asunto", type: "text", placeholder: "Asunto del email" },
      { key: "body", label: "Cuerpo", type: "textarea", placeholder: "Contenido del email..." },
    ],
  },
  {
    type: "move_lead",
    label: "Mover lead",
    category: "action",
    icon: MoveRight,
    color: "bg-blue-500",
    description: "Cambia el estado de un lead",
    configFields: [
      { key: "status", label: "Nuevo estado", type: "select", options: [
        { value: "new", label: "Nuevo" },
        { value: "contacted", label: "Contactado" },
        { value: "interested", label: "Interesado" },
        { value: "converted", label: "Convertido" },
      ]},
    ],
  },
  {
    type: "add_to_campaign",
    label: "Agregar a campaña",
    category: "action",
    icon: PlusCircle,
    color: "bg-blue-500",
    description: "Añade un lead a una campaña existente",
    configFields: [
      { key: "campaign_id", label: "ID Campaña", type: "text", placeholder: "ID de la campaña" },
    ],
  },
  {
    type: "wait",
    label: "Esperar",
    category: "action",
    icon: Timer,
    color: "bg-blue-500",
    description: "Pausa el workflow X tiempo",
    configFields: [
      { key: "delay", label: "Tiempo (minutos)", type: "number", defaultValue: 60 },
    ],
  },
  // AI
  {
    type: "ai_agent",
    label: "Agente IA",
    category: "ai",
    icon: Bot,
    color: "bg-purple-500",
    description: "Procesa input con un prompt personalizado",
    configFields: [
      { key: "prompt", label: "Prompt", type: "textarea", placeholder: "Describe qué debe hacer la IA..." },
      { key: "model", label: "Modelo", type: "select", options: [
        { value: "google/gemini-3-flash-preview", label: "Gemini Flash (rápido)" },
        { value: "google/gemini-2.5-pro", label: "Gemini Pro (preciso)" },
      ]},
    ],
  },
  {
    type: "classify_response",
    label: "Clasificar respuesta",
    category: "ai",
    icon: Tag,
    color: "bg-purple-500",
    description: "La IA clasifica si es positivo/negativo/neutral",
    configFields: [
      { key: "categories", label: "Categorías", type: "text", placeholder: "positivo, negativo, neutral" },
    ],
  },
  {
    type: "generate_email",
    label: "Generar email",
    category: "ai",
    icon: FileText,
    color: "bg-purple-500",
    description: "La IA genera un email basado en contexto",
    configFields: [
      { key: "tone", label: "Tono", type: "select", options: [
        { value: "formal", label: "Formal" },
        { value: "casual", label: "Casual" },
        { value: "persuasive", label: "Persuasivo" },
      ]},
      { key: "context", label: "Contexto adicional", type: "textarea", placeholder: "Info sobre el lead o producto..." },
    ],
  },
];

export const getNodeType = (type: string) => NODE_TYPES.find((n) => n.type === type);
