import { Sparkles, Mail, FileText, Podcast, Users, MoreHorizontal, EyeOff } from "lucide-react";

/* Marcas de los canales por los que alguien puede habernos encontrado. Dibujadas a mano en SVG
   para que pesen nada y se vean nítidas a cualquier tamaño. */

const S = "h-[22px] w-[22px]";

function OpenAiMark() {
  return (
    <span className={`${S} grid place-items-center rounded-full bg-[#0F172B]`}>
      <Sparkles className="h-[13px] w-[13px] text-white" strokeWidth={2.2} />
    </span>
  );
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#0A66C2" />
      <circle cx="6.6" cy="6.6" r="1.7" fill="#fff" />
      <rect x="5.2" y="9.4" width="2.9" height="9" rx=".5" fill="#fff" />
      <path d="M10.4 9.4h2.8v1.3c.5-.9 1.5-1.5 2.9-1.5 2.2 0 3.4 1.4 3.4 4v5.2h-2.9v-4.7c0-1.3-.5-2-1.6-2-1 0-1.7.7-1.7 2v4.7h-2.9z" fill="#fff" />
    </svg>
  );
}

function InstagramMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <defs>
        <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset=".35" stopColor="#FA7E1E" />
          <stop offset=".65" stopColor="#D62976" />
          <stop offset="1" stopColor="#962FBF" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#ig)" />
      <rect x="5" y="5" width="14" height="14" rx="4.4" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="16.4" cy="7.7" r="1" fill="#fff" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path d="M15.3 12.6h-2.2V20h-3v-7.4H8.4v-2.6h1.7V8.6c0-2.2 1.1-3.5 3.6-3.5h2v2.6h-1.3c-.9 0-1.3.4-1.3 1.2v1.1h2.6z" fill="#fff" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21 7.6 23.5 12 23.5z" />
      <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4z" />
      <path fill="#EA4335" d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15.1.5 12 .5 7.6.5 3.7 3 1.8 6.8l3.8 3c.9-2.7 3.4-4.7 6.4-4.7z" />
    </svg>
  );
}

function YoutubeMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <rect x="1" y="4.5" width="22" height="15" rx="4.2" fill="#FF0000" />
      <path d="M10 8.7l5.4 3.3-5.4 3.3z" fill="#fff" />
    </svg>
  );
}

function RedditMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#FF4500" />
      <circle cx="12" cy="14" r="6.4" fill="#fff" />
      <circle cx="9.7" cy="13.4" r="1.15" fill="#FF4500" />
      <circle cx="14.3" cy="13.4" r="1.15" fill="#FF4500" />
      <path d="M9.4 16.4c1.5 1.1 3.7 1.1 5.2 0" stroke="#FF4500" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <circle cx="19.4" cy="8.4" r="2" fill="#fff" />
      <circle cx="12" cy="6.3" r="1.5" fill="#fff" />
      <path d="M12 6.3l6.2 1.6" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

function TiktokMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <path d="M16.1 2.6c.4 2.3 1.7 3.6 3.9 3.8v2.5c-1.3.1-2.5-.2-3.8-1V14c0 4.3-4.1 6.6-7.5 4.8-3.3-1.8-3.4-6.5-.1-8.4 1-.6 2.2-.8 3.4-.6v2.6c-1.7-.3-2.9.8-2.8 2.2.1 1.3 1.3 2.2 2.6 2 1.2-.2 1.9-1.1 1.9-2.4V2.6z" fill="#25F4EE" transform="translate(-1.1 .6)" />
      <path d="M16.1 2.6c.4 2.3 1.7 3.6 3.9 3.8v2.5c-1.3.1-2.5-.2-3.8-1V14c0 4.3-4.1 6.6-7.5 4.8-3.3-1.8-3.4-6.5-.1-8.4 1-.6 2.2-.8 3.4-.6v2.6c-1.7-.3-2.9.8-2.8 2.2.1 1.3 1.3 2.2 2.6 2 1.2-.2 1.9-1.1 1.9-2.4V2.6z" fill="#FE2C55" transform="translate(.6 -.3)" />
      <path d="M16.1 2.6c.4 2.3 1.7 3.6 3.9 3.8v2.5c-1.3.1-2.5-.2-3.8-1V14c0 4.3-4.1 6.6-7.5 4.8-3.3-1.8-3.4-6.5-.1-8.4 1-.6 2.2-.8 3.4-.6v2.6c-1.7-.3-2.9.8-2.8 2.2.1 1.3 1.3 2.2 2.6 2 1.2-.2 1.9-1.1 1.9-2.4V2.6z" fill="#0F172B" />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" className={S} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#0F172B" />
      <path d="M6.3 6h3.2l2.8 3.9L15.6 6h2.2l-4.2 5.5 4.5 6.5h-3.2l-3-4.3-3.3 4.3H6.4l4.6-5.9z" fill="#fff" />
    </svg>
  );
}

const IconIn = ({ children }: { children: React.ReactNode }) => <span className={`${S} grid place-items-center`}>{children}</span>;

/** El dibujo de cada opción del paso "¿Cómo nos has encontrado?". */
export function SourceMark({ id }: { id: string }) {
  switch (id) {
    case "ai": return <OpenAiMark />;
    case "linkedin": return <LinkedInMark />;
    case "instagram": return <InstagramMark />;
    case "facebook": return <FacebookMark />;
    case "google": return <GoogleMark />;
    case "youtube": return <YoutubeMark />;
    case "reddit": return <RedditMark />;
    case "tiktok": return <TiktokMark />;
    case "x": return <XMark />;
    case "email": return <IconIn><Mail className="h-[19px] w-[19px] text-[#6E58F1]" strokeWidth={1.9} /></IconIn>;
    case "blog": return <IconIn><FileText className="h-[19px] w-[19px] text-[#45556C]" strokeWidth={1.9} /></IconIn>;
    case "podcast": return <IconIn><Podcast className="h-[19px] w-[19px] text-[#8B5CF6]" strokeWidth={1.9} /></IconIn>;
    case "friend": return <IconIn><Users className="h-[19px] w-[19px] text-[#45556C]" strokeWidth={1.9} /></IconIn>;
    case "other": return <IconIn><MoreHorizontal className="h-[19px] w-[19px] text-[#65768D]" strokeWidth={2.2} /></IconIn>;
    default: return <IconIn><EyeOff className="h-[19px] w-[19px] text-[#65768D]" strokeWidth={1.9} /></IconIn>;
  }
}
