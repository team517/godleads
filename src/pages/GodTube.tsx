import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { VideoCard } from "@/components/godtube/VideoCard";
import { VideoPlayer } from "@/components/godtube/VideoPlayer";
import { ChannelProfile } from "@/components/godtube/ChannelProfile";
import { CreateChannel } from "@/components/godtube/CreateChannel";
import { UploadVideo } from "@/components/godtube/UploadVideo";
import { Button } from "@/components/ui/button";
import { Tv, User, Plus, Loader2 } from "lucide-react";

type Channel = {
  id: string;
  user_id: string;
  channel_name: string;
  description: string;
  avatar_url: string | null;
  banner_url: string | null;
  is_official: boolean;
  created_at: string;
  updated_at: string;
};

type Video = {
  id: string;
  channel_id: string;
  user_id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  views: number;
  is_pinned: boolean;
  created_at: string;
};

type VideoWithChannel = Video & { channel: Channel };

type View = "feed" | "player" | "channel" | "create" | "edit";

const GodTube = () => {
  const { user } = useAuth();
  const [view, setView] = useState<View>("feed");
  const [loading, setLoading] = useState(true);
  const [myChannel, setMyChannel] = useState<Channel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [allVideos, setAllVideos] = useState<VideoWithChannel[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoWithChannel | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelVideos, setChannelVideos] = useState<Video[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: chans }, { data: vids }] = await Promise.all([
      supabase.from("godtube_channels").select("*").order("is_official", { ascending: false }),
      supabase.from("godtube_videos").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
    ]);

    const channelsList = (chans || []) as Channel[];
    const videosList = (vids || []) as Video[];
    setChannels(channelsList);

    const channelMap = new Map(channelsList.map((c) => [c.id, c]));
    const videosWithChannel: VideoWithChannel[] = videosList
      .map((v) => ({ ...v, channel: channelMap.get(v.channel_id)! }))
      .filter((v) => v.channel);

    setAllVideos(videosWithChannel);

    if (user) {
      const mine = channelsList.find((c) => c.user_id === user.id) || null;
      setMyChannel(mine);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openVideo = async (video: VideoWithChannel) => {
    setSelectedVideo(video);
    setView("player");
    // Increment views
    await supabase.rpc("increment_video_views", { video_id: video.id });
  };

  const openChannel = async (channel: Channel) => {
    setSelectedChannel(channel);
    const { data } = await supabase
      .from("godtube_videos")
      .select("*")
      .eq("channel_id", channel.id)
      .order("created_at", { ascending: false });
    setChannelVideos((data || []) as Video[]);
    setView("channel");
  };

  const officialVideos = allVideos.filter((v) => v.channel.is_official);
  const recentVideos = allVideos.filter((v) => !v.channel.is_official);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Create channel view
  if (view === "create" || view === "edit") {
    return (
      <div className="p-4 md:p-6">
        <CreateChannel
          existingChannel={view === "edit" ? myChannel : null}
          onComplete={() => { fetchData(); setView("feed"); }}
        />
      </div>
    );
  }

  // Video player view
  if (view === "player" && selectedVideo) {
    return (
      <div className="p-4 md:p-6">
        <VideoPlayer
          video={selectedVideo}
          channel={selectedVideo.channel}
          onBack={() => setView("feed")}
          onChannelClick={() => openChannel(selectedVideo.channel)}
        />
      </div>
    );
  }

  // Channel profile view
  if (view === "channel" && selectedChannel) {
    return (
      <div className="p-4 md:p-6">
        <ChannelProfile
          channel={selectedChannel}
          videos={channelVideos}
          isOwner={user?.id === selectedChannel.user_id}
          onBack={() => setView("feed")}
          onVideoClick={(v) => {
            const withChannel: VideoWithChannel = { ...v, is_pinned: (v as any).is_pinned ?? false, channel: selectedChannel };
            openVideo(withChannel);
          }}
          onUpload={() => setUploadOpen(true)}
          onEdit={() => setView("edit")}
        />
        {myChannel && (
          <UploadVideo
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            channelId={myChannel.id}
            onComplete={() => { fetchData(); openChannel(selectedChannel); }}
          />
        )}
      </div>
    );
  }

  // Feed view
  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center">
            <Tv className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">GodTube</h1>
            <p className="text-xs text-muted-foreground">Videos y tutoriales de la comunidad</p>
          </div>
        </div>
        <div className="flex gap-2">
          {myChannel ? (
            <>
              <Button size="sm" variant="outline" onClick={() => openChannel(myChannel)} className="gap-1.5">
                <User className="h-3.5 w-3.5" /> Mi Canal
              </Button>
              <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Subir
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setView("create")} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Crear Canal
            </Button>
          )}
        </div>
      </div>

      {/* Official tutorials */}
      {officialVideos.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold text-foreground">Tutoriales GodLeads</h2>
            <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full px-2 py-0.5">Oficial</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {officialVideos.map((v) => (
              <VideoCard
                key={v.id}
                id={v.id}
                title={v.title}
                thumbnailUrl={v.thumbnail_url}
                videoUrl={v.video_url}
                channelName={v.channel.channel_name}
                channelAvatar={v.channel.avatar_url}
                views={v.views}
                createdAt={v.created_at}
                isOfficial
                onClick={() => openVideo(v)}
                onChannelClick={() => openChannel(v.channel)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent videos */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Videos recientes</h2>
        {recentVideos.length === 0 && officialVideos.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Tv className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aún no hay videos</p>
            <p className="text-sm mt-1">¡Crea tu canal y sube el primero!</p>
          </div>
        ) : recentVideos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay más videos por ahora</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {recentVideos.map((v) => (
              <VideoCard
                key={v.id}
                id={v.id}
                title={v.title}
                thumbnailUrl={v.thumbnail_url}
                videoUrl={v.video_url}
                channelName={v.channel.channel_name}
                channelAvatar={v.channel.avatar_url}
                views={v.views}
                createdAt={v.created_at}
                onClick={() => openVideo(v)}
                onChannelClick={() => openChannel(v.channel)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Upload dialog */}
      {myChannel && (
        <UploadVideo
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          channelId={myChannel.id}
          onComplete={fetchData}
        />
      )}
    </div>
  );
};

export default GodTube;
