import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Camera, ImagePlus } from "lucide-react";

interface CreateChannelProps {
  existingChannel?: {
    id: string;
    channel_name: string;
    description: string;
    avatar_url: string | null;
    banner_url: string | null;
  } | null;
  onComplete: () => void;
}

export function CreateChannel({ existingChannel, onComplete }: CreateChannelProps) {
  const { user } = useAuth();
  const [name, setName] = useState(existingChannel?.channel_name || "");
  const [description, setDescription] = useState(existingChannel?.description || "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(existingChannel?.avatar_url || "");
  const [bannerPreview, setBannerPreview] = useState(existingChannel?.banner_url || "");
  const [loading, setLoading] = useState(false);

  const handleFilePreview = (file: File, setter: (url: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => setter(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadFile = async (file: File, folder: string) => {
    const ext = file.name.split(".").pop();
    const path = `${user!.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("godtube-media").upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from("godtube-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("El nombre del canal es obligatorio");
    if (!user) return;

    setLoading(true);
    try {
      let avatarUrl = existingChannel?.avatar_url || null;
      let bannerUrl = existingChannel?.banner_url || null;

      if (avatarFile) avatarUrl = await uploadFile(avatarFile, "avatars");
      if (bannerFile) bannerUrl = await uploadFile(bannerFile, "banners");

      if (existingChannel) {
        const { error } = await supabase
          .from("godtube_channels")
          .update({ channel_name: name.trim(), description: description.trim(), avatar_url: avatarUrl, banner_url: bannerUrl })
          .eq("id", existingChannel.id);
        if (error) throw error;
        toast.success("Canal actualizado");
      } else {
        const { error } = await supabase
          .from("godtube_channels")
          .insert({ user_id: user.id, channel_name: name.trim(), description: description.trim(), avatar_url: avatarUrl, banner_url: bannerUrl });
        if (error) throw error;
        toast.success("¡Canal creado!");
      }
      onComplete();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground">{existingChannel ? "Editar canal" : "Crea tu canal"}</h2>
          <p className="text-sm text-muted-foreground mt-1">Personaliza cómo te ven los demás en GodTube</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Banner */}
          <div>
            <Label className="text-xs text-muted-foreground">Banner</Label>
            <label className="block mt-1.5 cursor-pointer relative h-32 rounded-lg overflow-hidden bg-muted border-2 border-dashed border-border hover:border-primary/50 transition-colors">
              {bannerPreview ? (
                <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <ImagePlus className="h-6 w-6 mb-1" />
                  <span className="text-xs">Añadir banner</span>
                </div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setBannerFile(f); handleFilePreview(f, setBannerPreview); }
              }} />
            </label>
          </div>

          {/* Avatar */}
          <div>
            <Label className="text-xs text-muted-foreground">Foto de perfil</Label>
            <label className="flex items-center gap-4 mt-1.5 cursor-pointer">
              <div className="relative h-16 w-16 rounded-full overflow-hidden bg-muted border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">Haz clic para cambiar</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setAvatarFile(f); handleFilePreview(f, setAvatarPreview); }
              }} />
            </label>
          </div>

          <div>
            <Label htmlFor="channel-name" className="text-xs text-muted-foreground">Nombre del canal *</Label>
            <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi canal" className="mt-1.5" />
          </div>

          <div>
            <Label htmlFor="channel-desc" className="text-xs text-muted-foreground">Descripción</Label>
            <Textarea id="channel-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Sobre qué trata tu canal..." rows={3} className="mt-1.5" />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Guardando..." : existingChannel ? "Guardar cambios" : "Crear canal"}
          </Button>
        </form>
      </div>
    </div>
  );
}
