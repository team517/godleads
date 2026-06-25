import { ArrowLeft, Eye, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface VideoPlayerProps {
  video: {
    id: string;
    title: string;
    description: string;
    video_url: string;
    views: number;
    created_at: string;
  };
  channel: {
    id: string;
    channel_name: string;
    avatar_url: string | null;
    is_official: boolean;
  };
  onBack: () => void;
  onChannelClick: () => void;
}

export function VideoPlayer({ video, channel, onBack, onChannelClick }: VideoPlayerProps) {
  const initial = channel.channel_name.charAt(0).toUpperCase();

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-2" /> Volver
      </Button>

      {/* Video */}
      <div className="rounded-xl overflow-hidden bg-black">
        <video
          src={video.video_url}
          controls
          autoPlay
          className="w-full aspect-video"
        />
      </div>

      {/* Info */}
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground">{video.title}</h1>
        
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button onClick={onChannelClick} className="flex items-center gap-3 group">
            {channel.avatar_url ? (
              <img src={channel.avatar_url} alt={channel.channel_name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
                {initial}
              </div>
            )}
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{channel.channel_name}</span>
                {channel.is_official && (
                  <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full px-1.5 py-0.5">✓</span>
                )}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {video.views} vistas</span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {formatDistanceToNow(new Date(video.created_at), { addSuffix: true, locale: es })}
            </span>
          </div>
        </div>

        {video.description && (
          <div className="bg-muted rounded-xl p-4 text-sm text-foreground whitespace-pre-wrap">
            {video.description}
          </div>
        )}
      </div>
    </div>
  );
}
