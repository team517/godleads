import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, Film, ImagePlus } from "lucide-react";

interface UploadVideoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  onComplete: () => void;
}

export function UploadVideo({ open, onOpenChange, channelId, onComplete }: UploadVideoProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const reset = () => {
    setTitle(""); setDescription(""); setVideoFile(null); setThumbFile(null); setThumbPreview(""); setProgress(0);
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
    if (!title.trim() || !videoFile || !user) return toast.error("Título y video son obligatorios");

    setUploading(true);
    try {
      setProgress(20);
      const videoUrl = await uploadFile(videoFile, "videos");
      setProgress(70);

      let thumbnailUrl: string | null = null;
      if (thumbFile) {
        thumbnailUrl = await uploadFile(thumbFile, "thumbnails");
      }
      setProgress(85);

      const { error } = await supabase.from("godtube_videos").insert({
        channel_id: channelId,
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
      });
      if (error) throw error;

      setProgress(100);
      toast.success("¡Video subido!");
      reset();
      onOpenChange(false);
      onComplete();
    } catch (err: any) {
      toast.error(err.message || "Error al subir");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!uploading) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Subir video</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Video file */}
          <div>
            <Label className="text-xs text-muted-foreground">Archivo de video *</Label>
            <label className="mt-1.5 flex flex-col items-center justify-center h-28 rounded-lg border-2 border-dashed border-border hover:border-primary/50 bg-muted/50 cursor-pointer transition-colors">
              <Film className="h-6 w-6 text-muted-foreground mb-1" />
              <span className="text-xs text-muted-foreground">
                {videoFile ? videoFile.name : "Haz clic para seleccionar"}
              </span>
              <input type="file" accept="video/*" className="hidden" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          {/* Thumbnail */}
          <div>
            <Label className="text-xs text-muted-foreground">Miniatura (opcional)</Label>
            <label className="mt-1.5 flex items-center gap-3 cursor-pointer">
              <div className="h-16 w-28 rounded-lg overflow-hidden bg-muted border border-border flex items-center justify-center">
                {thumbPreview ? (
                  <img src={thumbPreview} alt="thumb" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">Imagen 16:9</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setThumbFile(f);
                  const r = new FileReader();
                  r.onloadend = () => setThumbPreview(r.result as string);
                  r.readAsDataURL(f);
                }
              }} />
            </label>
          </div>

          <div>
            <Label htmlFor="video-title" className="text-xs text-muted-foreground">Título *</Label>
            <Input id="video-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del video" className="mt-1.5" />
          </div>

          <div>
            <Label htmlFor="video-desc" className="text-xs text-muted-foreground">Descripción</Label>
            <Textarea id="video-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe tu video..." rows={3} className="mt-1.5" />
          </div>

          {uploading && <Progress value={progress} className="h-2" />}

          <Button type="submit" className="w-full" disabled={uploading}>
            {uploading ? `Subiendo... ${progress}%` : "Subir video"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
