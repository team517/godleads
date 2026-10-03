/* La ilustración de "No se encontraron contactos": una ventana con una lupa, rodeada de una
   órbita punteada con un sobre, unas personas y un documento flotando. Vectorial: nítida en
   cualquier pantalla y sin descargar imágenes. */
export function EmptyIllustration({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 290" fill="none" aria-hidden>
      <defs>
        <radialGradient id="ei-blob" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#DCE5FD" stopOpacity="0.95" />
          <stop offset="0.7" stopColor="#E8EDFD" stopOpacity="0.6" />
          <stop offset="1" stopColor="#F3F5FD" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ei-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#EEE9FD" />
          <stop offset="1" stopColor="#D9E3FC" />
        </linearGradient>
        <radialGradient id="ei-lens" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#E3EAFD" stopOpacity="0.7" />
        </radialGradient>
        <linearGradient id="ei-handle" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7B98F7" />
          <stop offset="1" stopColor="#4C6CE8" />
        </linearGradient>
        <linearGradient id="ei-mail" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9C7CF6" />
          <stop offset="1" stopColor="#7B5CEE" />
        </linearGradient>
        <linearGradient id="ei-doc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A07EF7" />
          <stop offset="1" stopColor="#7E5DF0" />
        </linearGradient>
        <linearGradient id="ei-users" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8EC0F8" />
          <stop offset="1" stopColor="#5E9BEF" />
        </linearGradient>
        <filter id="ei-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#5566B8" floodOpacity="0.13" />
        </filter>
        <filter id="ei-shadow-sm" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#5566B8" floodOpacity="0.14" />
        </filter>
        <filter id="ei-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Mancha de color detrás */}
      <ellipse cx="222" cy="150" rx="126" ry="122" fill="url(#ei-blob)" />

      {/* Órbita punteada */}
      <path d="M48 168 C 40 92, 108 34, 168 30" stroke="#C7CDE6" strokeWidth="1.4" strokeDasharray="3 5" strokeLinecap="round" />
      <path d="M298 146 C 330 170, 334 210, 312 232" stroke="#C7CDE6" strokeWidth="1.4" strokeDasharray="3 5" strokeLinecap="round" />
      <path d="M262 250 C 228 268, 160 270, 108 252" stroke="#C7CDE6" strokeWidth="1.4" strokeDasharray="3 5" strokeLinecap="round" />

      {/* Puntos */}
      <circle cx="170" cy="30" r="6" fill="#A9BCF6" />
      <circle cx="296" cy="144" r="6" fill="#7D9DEC" />
      <circle cx="263" cy="250" r="6" fill="#A98CF5" />

      {/* Ventana */}
      <g filter="url(#ei-shadow)">
        <rect x="96" y="82" width="176" height="152" rx="16" fill="#FFFFFF" />
      </g>
      <rect x="96" y="82" width="176" height="152" rx="16" fill="#FFFFFF" stroke="#EEF0F8" />
      <path d="M96 116 H272 V218 a16 16 0 0 1 -16 16 H112 a16 16 0 0 1 -16 -16 Z" fill="#F7F8FD" />
      <circle cx="112" cy="99" r="3.6" fill="#A58AF6" />
      <circle cx="124" cy="99" r="3.6" fill="#93AEF5" />
      <circle cx="136" cy="99" r="3.6" fill="#93AEF5" />
      <rect x="148" y="90" width="114" height="18" rx="9" fill="#FFFFFF" stroke="#E3E7F4" />
      <circle cx="248.5" cy="98.5" r="3.6" stroke="#8EA6F2" strokeWidth="1.6" />
      <path d="M251.2 101.2 254 104" stroke="#8EA6F2" strokeWidth="1.6" strokeLinecap="round" />

      {/* Filas de la lista */}
      {[134, 155, 176, 197].map((y) => (
        <g key={y}>
          <circle cx="116" cy={y} r="5" fill="#DCE1F4" />
          <rect x="127" y={y - 2.5} width="40" height="5" rx="2.5" fill="#E2E6F5" />
          <circle cx="210" cy={y} r="5" fill="#DCE1F4" />
          <rect x="221" y={y - 2.5} width="36" height="5" rx="2.5" fill="#E2E6F5" />
        </g>
      ))}

      {/* Lupa */}
      <g filter="url(#ei-shadow-sm)">
        <path d="M150 196 L120 228" stroke="url(#ei-handle)" strokeWidth="13" strokeLinecap="round" />
      </g>
      <circle cx="174" cy="170" r="35" fill="url(#ei-lens)" />
      <circle cx="174" cy="170" r="35" stroke="url(#ei-ring)" strokeWidth="8" />
      <path d="M154 158 a24 24 0 0 1 18 -12" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.9" />

      {/* Sobre */}
      <g transform="rotate(-9 70 177)" filter="url(#ei-shadow-sm)">
        <rect x="46" y="153" width="48" height="48" rx="12" fill="#FFFFFF" />
      </g>
      <g transform="rotate(-9 70 177)">
        <rect x="56" y="166" width="28" height="21" rx="4" fill="url(#ei-mail)" />
        <path d="M58 169 L70 178 L82 169" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* Personas */}
      <g transform="rotate(6 306 70)" filter="url(#ei-shadow-sm)">
        <rect x="282" y="46" width="48" height="48" rx="12" fill="#FFFFFF" />
      </g>
      <g transform="rotate(6 306 70)">
        <circle cx="301" cy="63" r="5.2" fill="url(#ei-users)" />
        <path d="M291 80 c0 -6 4.5 -9.5 10 -9.5 s10 3.5 10 9.5 Z" fill="url(#ei-users)" />
        <circle cx="314" cy="65" r="4.2" fill="#A9CCF9" />
        <path d="M309 79.5 c0.6 -5 3.5 -7.6 7.2 -7.6 c4.2 0 7 3 7 7.6 Z" fill="#A9CCF9" />
      </g>

      {/* Documento */}
      <g transform="rotate(8 304 214)" filter="url(#ei-shadow-sm)">
        <rect x="280" y="190" width="48" height="48" rx="12" fill="#FFFFFF" />
      </g>
      <g transform="rotate(8 304 214)">
        <path d="M294 200 h13 l7 7 v19 a3 3 0 0 1 -3 3 h-17 a3 3 0 0 1 -3 -3 v-23 a3 3 0 0 1 3 -3 Z" fill="url(#ei-doc)" />
        <path d="M296.5 212 h12 M296.5 217 h12 M296.5 222 h8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
