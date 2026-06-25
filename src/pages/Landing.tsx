import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  Zap,
  Mail,
  BarChart3,
  Shield,
  Clock,
  Users,
  Inbox,
  ArrowRight,
  Check,
  MessageCircle,
  Send,
  Star,
  TrendingUp,
  Globe,
  Rocket,
  ChevronRight,
  CheckCircle2,
  Play,
  Smartphone,
  Download,
  Award,
  X,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
const features = [
  {
    icon: Mail,
    title: "Conexión SMTP/IMAP Masiva",
    description: "Conecta cientos de cuentas via CSV. Validación automática, warmup inteligente y rotación.",
    color: "brand-purple",
  },
  {
    icon: Send,
    title: "Campañas con A/B Testing",
    description: "Secuencias con variantes A/B/C, follow-ups automáticos y variables dinámicas.",
    color: "brand-cyan",
  },
  {
    icon: Inbox,
    title: "Unibox Centralizado",
    description: "Todas las respuestas de todas tus cuentas en un solo lugar. Tiempo real.",
    color: "brand-blue",
  },
  {
    icon: Shield,
    title: "Anti-Spam Enterprise",
    description: "Delays aleatorios, warmup gradual, rotación inteligente y monitoreo 24/7.",
    color: "brand-teal",
  },
  {
    icon: Clock,
    title: "Programación Inteligente",
    description: "Horarios de envío, límites diarios, zonas horarias y ventanas óptimas.",
    color: "brand-indigo",
  },
  {
    icon: BarChart3,
    title: "Analytics Avanzados",
    description: "Dashboards con métricas de aperturas, respuestas, rebotes y rendimiento.",
    color: "brand-sky",
  },
];

const caseStudies = [
  {
    company: "TechScale Solutions",
    logo: "TS",
    industry: "SaaS B2B",
    metric: "+340%",
    metricLabel: "Tasa de respuesta",
    quote: "Pasamos de 2% a 8.8% de tasa de respuesta en solo 3 semanas. GodLeads transformó nuestro pipeline.",
    person: "Carlos Méndez",
    role: "VP de Ventas",
  },
  {
    company: "GrowthForge Agency",
    logo: "GF",
    industry: "Agencia de Marketing",
    metric: "€2.1M",
    metricLabel: "Revenue generado",
    quote: "En 6 meses generamos €2.1M en pipeline para nuestros clientes. La automatización es brutal.",
    person: "Ana Rodríguez",
    role: "CEO & Fundadora",
  },
  {
    company: "Nexus Consulting",
    logo: "NC",
    industry: "Consultoría",
    metric: "47",
    metricLabel: "Reuniones/mes",
    quote: "De 8 reuniones al mes pasamos a 47. El Unibox nos permite responder en segundos.",
    person: "David López",
    role: "Director Comercial",
  },
];

const stats = [
  { value: "50M+", label: "Emails enviados" },
  { value: "12,000+", label: "Empresas activas" },
  { value: "99.2%", label: "Deliverability rate" },
  { value: "8.5%", label: "Tasa de respuesta media" },
];

const pricingPlans = [
  {
    name: "Starter",
    price: "29",
    description: "Para equipos que están empezando",
    features: ["3 cuentas de email", "1,000 leads", "Campañas ilimitadas", "Follow-ups automáticos", "Soporte por email"],
  },
  {
    name: "Growth",
    price: "79",
    popular: true,
    description: "Para equipos que quieren escalar",
    features: ["15 cuentas de email", "10,000 leads", "A/B Testing", "Unibox centralizado", "Analytics avanzados", "Soporte prioritario"],
  },
  {
    name: "Scale",
    price: "199",
    description: "Para agencias y grandes equipos",
    features: ["Cuentas ilimitadas", "Leads ilimitados", "API completa", "White label", "Account manager dedicado", "SLA garantizado"],
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

export default function Landing() {
  const [showInstallBanner, setShowInstallBanner] = useState(true);
  const isMobileDevice = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isStandalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Mobile install banner */}
      {isMobileDevice && !isStandalone && showInstallBanner && (
        <div className="sticky top-0 z-[60] flex items-center justify-between gap-3 bg-primary px-4 py-2.5">
          <div className="flex items-center gap-2 text-primary-foreground text-sm min-w-0">
            <Smartphone className="h-4 w-4 flex-shrink-0" />
            <span className="truncate font-medium">Instala GodLeads en tu móvil</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link to="/install">
              <Button size="sm" variant="secondary" className="h-7 px-3 text-xs font-bold rounded-full">
                Instalar
              </Button>
            </Link>
            <button onClick={() => setShowInstallBanner(false)} className="text-primary-foreground/70 hover:text-primary-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {/* Navbar — clean, minimal */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center">
            <Wordmark className="h-7" colorClassName="text-primary" />
          </Link>
          <div className="hidden md:flex items-center gap-8">
            {[
              { label: "Producto", href: "#features" },
              { label: "Casos de Éxito", href: "#cases" },
              { label: "Precios", href: "#pricing" },
              { label: "Nosotros", href: "#about" },
            ].map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <Link to="/install" className="md:hidden">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Download className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="font-medium">Iniciar Sesión</Button>
            </Link>
            <Link to="/auth?mode=signup">
              <Button size="sm" className="rounded-full px-4 md:px-5 font-semibold uppercase tracking-wide text-xs h-9">
                Empezar Gratis
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — split layout like Instantly */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-hero" />
        <div className="absolute top-20 -left-32 h-80 w-80 rounded-full bg-brand-purple/20 blur-3xl" />
        <div className="absolute top-40 -right-32 h-80 w-80 rounded-full bg-brand-cyan/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-64 w-64 rounded-full bg-brand-indigo/15 blur-3xl" />
        <div className="container relative grid lg:grid-cols-2 gap-12 lg:gap-8 items-center pt-16 pb-20 lg:pt-24 lg:pb-28">
          {/* Left — text */}
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.h1
              variants={fadeUp}
              custom={0}
              className="font-display text-4xl sm:text-5xl lg:text-6xl xl:text-[4.25rem] font-bold tracking-tight leading-[1.1]"
            >
              Encuentra, Contacta y Cierra{" "}
              <span className="bg-gradient-brand bg-clip-text text-transparent">Tus Clientes Ideales</span>
            </motion.h1>

            <motion.p variants={fadeUp} custom={1} className="mt-6 text-lg text-muted-foreground max-w-lg leading-relaxed">
              GodLeads te ayuda a encontrar leads cualificados, escalar campañas de email, llegar a la bandeja principal y ganar más con IA.
            </motion.p>

            <motion.div variants={fadeUp} custom={2} className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/auth?mode=signup">
                <Button size="lg" className="rounded-full px-8 h-13 text-sm font-bold uppercase tracking-wider shadow-lg shadow-brand-purple/30 bg-gradient-brand hover:opacity-90 text-white border-0">
                  Empezar Gratis
                </Button>
              </Link>
              <a href="#cases">
                <Button variant="outline" size="lg" className="rounded-full px-8 h-13 text-sm font-bold uppercase tracking-wider gap-2 border-2">
                  <Play className="h-4 w-4 text-brand-cyan" /> Ver Demo
                </Button>
              </a>
            </motion.div>

            <motion.div variants={fadeUp} custom={3} className="mt-6 flex items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-brand-teal" /> Sin tarjeta de crédito
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-brand-teal" /> Leads gratis incluidos
              </span>
            </motion.div>
          </motion.div>

          {/* Right — dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="rounded-2xl border bg-card shadow-2xl shadow-primary/10 overflow-hidden">
              {/* Mock top bar */}
              <div className="flex items-center gap-2 border-b px-4 py-3 bg-muted/30">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-destructive/60" />
                  <div className="h-3 w-3 rounded-full bg-warning/60" />
                  <div className="h-3 w-3 rounded-full bg-success/60" />
                </div>
                <div className="flex items-center gap-4 ml-4 text-xs font-medium text-muted-foreground">
                  {["Analytics", "Leads", "Sequences", "Schedule"].map((tab, i) => (
                    <span key={tab} className={i === 0 ? "text-primary font-semibold" : ""}>{tab}</span>
                  ))}
                </div>
              </div>
              {/* Mock dashboard content */}
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "CONTACTED", value: "1,770", icon: Users, color: "text-primary" },
                    { label: "OPENED", value: "338", icon: Mail, color: "text-warning" },
                    { label: "REPLIED", value: "44", icon: MessageCircle, color: "text-success" },
                    { label: "POSITIVE", value: "13", icon: TrendingUp, color: "text-destructive" },
                  ].map((stat, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                      className="rounded-xl border bg-background p-3 text-center"
                    >
                      <stat.icon className={`h-4 w-4 mx-auto mb-1 ${stat.color}`} />
                      <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                      <p className="font-display text-xl font-bold mt-0.5">{stat.value}</p>
                    </motion.div>
                  ))}
                </div>
                {/* Mock chart area */}
                <div className="rounded-xl border bg-background p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Analytics</span>
                    <span className="text-xs text-muted-foreground">Last Year</span>
                  </div>
                  <div className="h-32 flex items-end gap-1">
                    {[30, 45, 35, 55, 70, 85, 65, 90, 75, 95, 80, 88].map((h, i) => (
                      <motion.div
                        key={i}
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ delay: 0.8 + i * 0.05, duration: 0.4 }}
                        className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/80 to-primary/30"
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                    {["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"].map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                </div>
                {/* Mock legend */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {[
                    { color: "bg-primary", label: "Contacted" },
                    { color: "bg-warning", label: "Opened" },
                    { color: "bg-success", label: "Positive" },
                    { color: "bg-info", label: "Replied" },
                  ].map((item) => (
                    <span key={item.label} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${item.color}`} />
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Floating revenue card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
              className="absolute -bottom-4 -right-4 rounded-xl border bg-card shadow-lg p-3 flex items-center gap-2"
            >
              <div className="h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">REVENUE</p>
                <p className="font-display text-lg font-bold">€3,900</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Social proof — customer count */}
      <section className="py-16 border-t border-b bg-muted/20">
        <div className="container">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-display text-3xl md:text-4xl font-bold">
                <span className="text-foreground">40,000+ clientes</span>{" "}
                <span className="text-muted-foreground font-normal">que consiguen más respuestas</span>
              </h2>
            </motion.div>
            <motion.a
              href="#cases"
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold uppercase tracking-wider hover:border-primary hover:text-primary transition-colors"
            >
              Ver Más <ArrowRight className="h-4 w-4" />
            </motion.a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-20">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => {
              const colors = ["text-brand-purple", "text-brand-cyan", "text-brand-teal", "text-brand-indigo"];
              return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <p className={`font-display text-4xl md:text-5xl font-bold ${colors[i]}`}>{stat.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
              </motion.div>
            );
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-muted/20 border-t">
        <div className="container">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="max-w-2xl">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-semibold uppercase tracking-wider text-brand-purple mb-3">
              Producto
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="font-display text-3xl md:text-5xl font-bold">
              Todo lo que necesitas para{" "}
              <span className="bg-gradient-warm bg-clip-text text-transparent">dominar el outreach</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg text-muted-foreground">
              Plataforma completa para gestionar campañas de cold email. Sin curva de aprendizaje.
            </motion.p>
          </motion.div>

          <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="group rounded-2xl border bg-card p-7 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                style={{ borderTopColor: `hsl(var(--${feature.color}))`, borderTopWidth: '3px' }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `hsl(var(--${feature.color}))` }}
                >
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 border-t">
        <div className="container max-w-5xl">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center max-w-2xl mx-auto">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-semibold uppercase tracking-wider text-brand-cyan mb-3">
              Cómo funciona
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="font-display text-3xl md:text-5xl font-bold">
              De cero a enviando en <span className="bg-gradient-cool bg-clip-text text-transparent">5 minutos</span>
            </motion.h2>
          </motion.div>

          <div className="mt-16 grid md:grid-cols-3 gap-12">
            {[
              { step: "01", title: "Conecta tus cuentas", description: "Sube un CSV con tus cuentas SMTP/IMAP o añádelas manualmente.", icon: Mail, color: "brand-purple" },
              { step: "02", title: "Crea tu campaña", description: "Escribe secuencias con variantes A/B, variables y follow-ups.", icon: Send, color: "brand-cyan" },
              { step: "03", title: "Monitorea resultados", description: "Recibe respuestas en el Unibox y analiza métricas en tiempo real.", icon: BarChart3, color: "brand-teal" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="text-center"
              >
                <div
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg mb-5"
                  style={{ backgroundColor: `hsl(var(--${item.color}))` }}
                >
                  <item.icon className="h-7 w-7" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: `hsl(var(--${item.color}))` }}>Paso {item.step}</span>
                <h3 className="mt-2 font-display text-xl font-bold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Case Studies */}
      <section id="cases" className="py-24 bg-muted/20 border-t">
        <div className="container">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="max-w-2xl">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-semibold uppercase tracking-wider text-brand-indigo mb-3">
              Casos de Éxito
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="font-display text-3xl md:text-5xl font-bold">
              Resultados que <span className="bg-gradient-brand bg-clip-text text-transparent">hablan por sí solos</span>
            </motion.h2>
          </motion.div>

          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {caseStudies.map((cs, i) => {
              const gradients = ["bg-gradient-brand", "bg-gradient-warm", "bg-gradient-cool"];
              return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="rounded-2xl border bg-card overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`${gradients[i]} p-7 text-white`}>
                  <div className="flex items-center justify-between">
                    <div className="h-10 w-10 rounded-lg bg-white/25 backdrop-blur flex items-center justify-center font-display font-bold text-sm">
                      {cs.logo}
                    </div>
                    <span className="rounded-full bg-white/25 backdrop-blur px-3 py-1 text-xs font-medium">{cs.industry}</span>
                  </div>
                  <p className="mt-5 font-display text-4xl font-bold">{cs.metric}</p>
                  <p className="text-sm opacity-90">{cs.metricLabel}</p>
                </div>
                <div className="p-7">
                  <p className="text-sm text-muted-foreground leading-relaxed italic">"{cs.quote}"</p>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                      {cs.person.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{cs.person}</p>
                      <p className="text-xs text-muted-foreground">{cs.role}, {cs.company}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-24 border-t">
        <div className="container max-w-5xl">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal mb-3">Sobre Nosotros</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold">
                Expertos en <span className="bg-gradient-cool bg-clip-text text-transparent">deliverability</span> y outbound
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Equipo de veteranos del mundo SaaS B2B, con experiencia en Stripe, HubSpot y Factorial. 
                Nuestra obsesión es que tus emails lleguen a la bandeja principal, no a spam.
              </p>
              <div className="mt-6 flex items-center gap-6 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Globe className="h-4 w-4 text-brand-teal" /> Barcelona</span>
                <span className="flex items-center gap-2 text-muted-foreground"><Users className="h-4 w-4 text-brand-purple" /> 25+ personas</span>
              </div>
            </motion.div>
            <div className="space-y-4">
              {[
                { name: "Alejandro Torres", role: "CEO & Co-Fundador", bio: "Ex-VP Ventas en Factorial.", initials: "AT", color: "brand-purple" },
                { name: "Marina García", role: "CTO & Co-Fundadora", bio: "Ex-Ingeniera Senior en Stripe.", initials: "MG", color: "brand-cyan" },
                { name: "Daniel Ruiz", role: "Head of Product", bio: "Ex-Product Lead en HubSpot.", initials: "DR", color: "brand-indigo" },
              ].map((member, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 hover:shadow-md transition-shadow"
                >
                  <div
                    className="h-12 w-12 shrink-0 rounded-xl flex items-center justify-center font-display font-bold text-white shadow-md"
                    style={{ backgroundColor: `hsl(var(--${member.color}))` }}
                  >
                    {member.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{member.name}</p>
                    <p className="text-xs font-medium" style={{ color: `hsl(var(--${member.color}))` }}>{member.role}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{member.bio}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-muted/20 border-t">
        <div className="container max-w-5xl">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center max-w-2xl mx-auto">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-semibold uppercase tracking-wider text-brand-purple mb-3">
              Precios
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="font-display text-3xl md:text-5xl font-bold">
              Planes simples, <span className="bg-gradient-warm bg-clip-text text-transparent">resultados extraordinarios</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-muted-foreground">
              Sin sorpresas. Sin costes ocultos. Cancela cuando quieras.
            </motion.p>
          </motion.div>

          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {pricingPlans.map((plan, i) => {
              const planColors = ["brand-blue", "brand-cyan", "brand-indigo"];
              const c = planColors[i];
              return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative rounded-2xl border-2 bg-card p-8 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                  plan.popular ? "shadow-xl scale-[1.02]" : ""
                }`}
                style={plan.popular ? { borderColor: `hsl(var(--${c}))` } : {}}
              >
                {plan.popular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-5 py-1 text-xs font-bold text-white uppercase tracking-wider shadow-lg"
                    style={{ backgroundColor: `hsl(var(--${c}))` }}
                  >
                    Popular
                  </div>
                )}
                <h3 className="font-display text-xl font-bold" style={{ color: `hsl(var(--${c}))` }}>{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-5xl font-bold">€{plan.price}</span>
                  <span className="text-muted-foreground">/mes</span>
                </div>
                <ul className="mt-7 space-y-3">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2.5 text-sm">
                      <Check className="h-4 w-4 shrink-0" style={{ color: `hsl(var(--${c}))` }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/auth?mode=signup">
                  <Button
                    className={`mt-8 w-full rounded-full h-11 font-semibold uppercase text-xs tracking-wider text-white border-0 hover:opacity-90 ${
                      plan.popular ? "shadow-lg" : ""
                    }`}
                    style={{ backgroundColor: `hsl(var(--${c}))` }}
                  >
                    Empezar con {plan.name}
                  </Button>
                </Link>
              </motion.div>
              );
            })}
          </div>
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Todos los planes incluyen 7 días de prueba gratuita. Sin tarjeta de crédito.
          </p>
        </div>
      </section>

      {/* Install App */}
      <section className="py-24 border-t bg-muted/20">
        <div className="container max-w-4xl">
          <div className="rounded-3xl border-2 bg-card p-10 md:p-14 text-center relative overflow-hidden">
            <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-brand-cyan/15 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-brand-purple/15 blur-3xl" />
            <div className="relative">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand shadow-lg shadow-brand-purple/30">
                <Smartphone className="h-8 w-8 text-white" />
              </div>
              <h2 className="mt-6 font-display text-3xl md:text-4xl font-bold">
                Lleva GodLeads en tu <span className="bg-gradient-brand bg-clip-text text-transparent">bolsillo</span>
              </h2>
              <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
                Instala la app en tu iPhone o Android directamente desde el navegador. Sin tiendas, sin descargas pesadas.
              </p>
              <Link to="/install">
                <Button size="lg" className="mt-8 rounded-full px-8 h-12 font-bold uppercase text-xs tracking-wider gap-2 bg-gradient-brand text-white border-0 hover:opacity-90 shadow-lg shadow-brand-purple/30">
                  <Download className="h-4 w-4" /> Instalar App
                </Button>
              </Link>
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand-teal" /> Compatible con iPhone
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand-teal" /> Compatible con Android
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-brand-teal" /> Funciona offline
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t">
        <div className="container max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-3xl bg-gradient-brand p-12 md:p-16 text-center relative overflow-hidden shadow-2xl shadow-brand-purple/30"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.15),transparent_60%)]" />
            <div className="absolute -top-20 -right-10 h-60 w-60 rounded-full bg-brand-indigo/30 blur-3xl" />
            <div className="absolute -bottom-20 -left-10 h-60 w-60 rounded-full bg-brand-sky/20 blur-3xl" />
            <div className="relative">
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white">
                ¿Listo para escalar tu outreach?
              </h2>
              <p className="mt-4 text-white/85 max-w-xl mx-auto">
                Únete a 12,000+ empresas que usan GodLeads para generar más reuniones y cerrar más ventas.
              </p>
              <Link to="/auth?mode=signup">
                <Button
                  size="lg"
                  className="mt-8 rounded-full px-8 h-12 font-bold uppercase text-xs tracking-wider shadow-xl bg-white text-brand-purple hover:bg-white/95 border-0"
                >
                  Empezar Gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-14 bg-muted/20">
        <div className="container">
          <div className="grid gap-10 md:grid-cols-4">
            <div>
              <Wordmark className="h-6" colorClassName="text-primary" />
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                La plataforma de cold email #1 para equipos de ventas B2B.
              </p>
            </div>
            {[
              { title: "Producto", links: [{ label: "Características", href: "#features" }, { label: "Precios", href: "#pricing" }, { label: "Casos de Éxito", href: "#cases" }] },
              { title: "Empresa", links: [{ label: "Nosotros", href: "#about" }, { label: "Blog", href: "#" }, { label: "Contacto", href: "#" }] },
              { title: "Legal", links: [{ label: "Términos", href: "#" }, { label: "Privacidad", href: "#" }, { label: "RGPD", href: "#" }] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="font-display font-semibold text-sm mb-3">{col.title}</h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{link.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 pt-6 border-t flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">© 2026 GodLeads. Todos los derechos reservados.</p>
            <p className="text-xs text-muted-foreground">Hecho con ❤️ en Barcelona</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
