import { Play, Eye } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface VideoCardProps {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  channelName: string;
  channelAvatar: string | null;
  views: number;
  createdAt: string;
  isOfficial?: boolean;
  onClick: () => void;
  onChannelClick?: () => void;
}

export function VideoCard({
  title,
  thumbnailUrl,
  videoUrl,
  channelName,
  channelAvatar,
  views,
  createdAt,
  isOfficial,
  onClick,
  onChannelClick,
}: VideoCardProps) {
  const initial = channelName.charAt(0).toUpperCase();
  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: es });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="group cursor-pointer"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="relative rounded-xl overflow-hidden bg-muted mb-3">
        <AspectRatio ratio={16 / 9}>
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <video
              src={videoUrl}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
            />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-primary rounded-full p-3 shadow-lg">
              <Play className="h-5 w-5 text-primary-foreground fill-current" />
            </div>
          </div>
        </AspectRatio>
      </div>

      {/* Info */}
      <div className="flex gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); onChannelClick?.(); }}
          className="flex-shrink-0"
        >
          {channelAvatar ? (
            <img src={channelAvatar} alt={channelName} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
              {initial}
            </div>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight mb-1 group-hover:text-primary transition-colors">
            {title}
          </h3>
          <button
            onClick={(e) => { e.stopPropagation(); onChannelClick?.(); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {channelName}
            {isOfficial && (
              <span className="inline-flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-bold rounded-full px-1.5 py-0.5">✓</span>
            )}
          </button>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{views}</span>
            <span>•</span>
            <span>{timeAgo}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
