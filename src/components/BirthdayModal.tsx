import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { toast } from "sonner";
import { Gift, PartyPopper } from "lucide-react";
import coinIcon from "@/assets/coin-icon.png";

export default function BirthdayModal() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [birthday, setBirthday] = useState("");
  const [saving, setSaving] = useState(false);

  // Show only if user has no birthday set
  const open = !!user && profile.birthday === null && profile.full_name !== undefined;

  const handleSave = async () => {
    if (!birthday || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ birthday } as any)
        .eq("user_id", user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success("🎂 ¡Guardado! Recibirás 50 monedas en tu aniversario");
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="text-center items-center">
          <div className="mx-auto mb-2 flex items-center justify-center gap-2">
            <PartyPopper className="h-8 w-8 text-warning" />
            <Gift className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-xl">¡Bienvenido a GodLeads! 🎉</DialogTitle>
          <DialogDescription className="text-center">
            Queremos celebrar contigo. Dinos cuándo es tu aniversario y te regalaremos{" "}
            <span className="inline-flex items-center gap-1 font-bold text-warning">
              50 <img src={coinIcon} alt="" className="h-4 w-4 inline" /> monedas
            </span>{" "}
            ese día.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="birthday">📅 ¿Cuándo es tu aniversario?</Label>
            <Input
              id="birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              className="text-center text-lg"
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!birthday || saving}
            onClick={handleSave}
          >
            {saving ? "Guardando..." : "🎁 Guardar y recibir monedas en mi aniversario"}
          </Button>

          <p className="text-[11px] text-muted-foreground text-center">
            Cada año, recibirás 50 monedas gratis en tu día especial 🎂
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
