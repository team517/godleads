import { motion } from "framer-motion";
import { SparkMark } from "@/components/SparkMark";

/* Funny, el guía del tutorial: la estrella de la marca con ojos que parpadean, flotando un poco.
 * Mientras habla, la boca se mueve. Con "reducir movimiento" se queda quieto. */

export function FunnyGuide({ size = 72, talking = false, reduced = false }: { size?: number; talking?: boolean; reduced?: boolean }) {
  const eyeW = Math.max(5, Math.round(size * 0.085));
  const eyeH = Math.max(7, Math.round(size * 0.12));
  return (
    <motion.div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      animate={reduced ? undefined : { y: [0, -5, 0], rotate: [0, -2, 0, 2, 0] }}
      transition={reduced ? undefined : { y: { repeat: Infinity, duration: 3.2, ease: "easeInOut" }, rotate: { repeat: Infinity, duration: 6, ease: "easeInOut" } }}
      aria-hidden="true"
      data-testid="funny-guide"
    >
      {/* Halo */}
      <span className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(139,123,255,.55),rgba(56,189,248,.18)_55%,transparent_72%)] blur-md" />
      <SparkMark variant="star" size={size} className="relative drop-shadow-[0_8px_16px_rgba(91,64,251,.35)]" />
      {/* Cara */}
      <span className="absolute left-1/2 top-[47%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ gap: Math.round(size * 0.035) }}>
        <span className="flex" style={{ gap: Math.round(size * 0.075) }}>
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              className="relative block rounded-full bg-white shadow-[0_1px_2px_rgba(30,20,90,.35)]"
              style={{ width: eyeW, height: eyeH }}
              animate={reduced ? undefined : { scaleY: [1, 1, 0.12, 1] }}
              transition={reduced ? undefined : { repeat: Infinity, duration: 4.2, times: [0, 0.9, 0.95, 1], delay: 0.6 }}
            >
              <span className="absolute bottom-[18%] left-1/2 block -translate-x-1/2 rounded-full bg-[#1B1440]" style={{ width: eyeW * 0.6, height: eyeW * 0.6 }} />
            </motion.span>
          ))}
        </span>
        <motion.span
          className="block rounded-b-full border-b-2 border-white/95"
          style={{ width: Math.round(size * 0.13), height: Math.round(size * 0.05) }}
          animate={talking && !reduced ? { scaleY: [1, 2.2, 1, 1.8, 1] } : { scaleY: 1 }}
          transition={talking && !reduced ? { repeat: Infinity, duration: 0.6 } : { duration: 0.2 }}
        />
      </span>
    </motion.div>
  );
}

export default FunnyGuide;
