import { ArrowLeft, Upload, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoCard } from "./VideoCard";

interface Channel {
  id: string;
  user_id: string;
  channel_name: string;
  description: string;
  avatar_url: string | null;
  banner_url: string | null;
  is_official: boolean;
}

interface Video {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  views: number;
  created_at: string;
  channel_id: string;
  user_id: string;
}

interface ChannelProfileProps {
  channel: Channel;
  videos: Video[];
  isOwner: boolean;
  onBack: () => void;
  onVideoClick: (video: Video) => void;
  onUpload: () => void;
  onEdit: () => void;
}

export function ChannelProfile({ channel, videos, isOwner, onBack, onVideoClick, onUpload, onEdit }: ChannelProfileProps) {
  const initial = channel.channel_name.charAt(0).toUpperCase();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-2" /> Volver
      </Button>

      {/* Banner */}
      <div className="relative h-40 md:h-56 rounded-xl overflow-hidden">
        {channel.banner_url ? (
          <img src={channel.banner_url} alt="Banner" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/80 via-primary/50 to-accent" />
        )}
      </div>

      {/* Channel info */}
      <div className="flex items-start gap-4 -mt-10 ml-6 relative z-10">
        {channel.avatar_url ? (
          <img src={channel.avatar_url} alt={channel.channel_name} className="h-20 w-20 rounded-full object-cover border-4 border-background shadow-lg" />
        ) : (
          <div className="h-20 w-20 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold border-4 border-background shadow-lg">
            {initial}
          </div>
        )}
        <div className="pt-12 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">{channel.channel_name}</h2>
            {channel.is_official && (
              <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-2 py-0.5">✓ Oficial</span>
            )}
          </div>
          {channel.description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">{channel.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">{videos.length} video{videos.length !== 1 ? 's' : ''}</p>
        </div>

        {isOwner && (
          <div className="pt-12 flex gap-2">
            <Button size="sm" onClick={onUpload} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Subir video
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit} className="gap-1.5">
              <Settings className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        )}
      </div>

      {/* Videos grid */}
      <div className="pt-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">Videos</h3>
        {videos.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Este canal aún no tiene videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                id={v.id}
                title={v.title}
                thumbnailUrl={v.thumbnail_url}
                videoUrl={v.video_url}
                channelName={channel.channel_name}
                channelAvatar={channel.avatar_url}
                views={v.views}
                createdAt={v.created_at}
                isOfficial={channel.is_official}
                onClick={() => onVideoClick(v)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
