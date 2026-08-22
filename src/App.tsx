import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { VerificationProvider } from "@/contexts/VerificationContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-retry";
// Lazy: the chatbot pulls in recharts + react-markdown + framer-motion. Loading
// it eagerly bloated the initial bundle of EVERY page. Now it loads on idle,
// after the page is interactive.
const ColdEmailChatbot = lazyWithRetry(() =>
  import("@/components/ColdEmailChatbot").then((m) => ({ default: m.ColdEmailChatbot })),
);

const Landing = lazyWithRetry(() => import("./pages/Landing"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const EmailAccounts = lazyWithRetry(() => import("./pages/EmailAccounts"));
const Campaigns = lazyWithRetry(() => import("./pages/Campaigns"));
const Leads = lazyWithRetry(() => import("./pages/Leads"));
const Unibox = lazyWithRetry(() => import("./pages/Unibox"));
const Stats = lazyWithRetry(() => import("./pages/Stats"));
const Personalizacion = lazyWithRetry(() => import("./pages/Personalizacion"));
const DeliverabilityTest = lazyWithRetry(() => import("./pages/DeliverabilityTest"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const AIPrompts = lazyWithRetry(() => import("./pages/AIPrompts"));
const AdminPanel = lazyWithRetry(() => import("./pages/AdminPanel"));
const ClientPortal = lazyWithRetry(() => import("./pages/ClientPortal"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const Install = lazyWithRetry(() => import("./pages/Install"));
const Community = lazyWithRetry(() => import("./pages/Community"));
const Onboarding = lazyWithRetry(() => import("./pages/Onboarding"));
const OnboardingPortal = lazyWithRetry(() => import("./pages/OnboardingPortal"));
const ClientCampaigns = lazyWithRetry(() => import("./pages/ClientCampaigns"));
const AutomationFlow = lazyWithRetry(() => import("./pages/AutomationFlow"));
const Seguimiento = lazyWithRetry(() => import("./pages/Seguimiento"));
const GodTube = lazyWithRetry(() => import("./pages/GodTube"));
const Partners = lazyWithRetry(() => import("./pages/Partners"));
const Metrics = lazyWithRetry(() => import("./pages/Metrics"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
        <SubscriptionProvider>
        <ProfileProvider>
        <VerificationProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/install" element={<Install />} />
              <Route path="/auth" element={<Auth />} />
              {/* Public client onboarding portal — client logs in with the
                  credentials the owner created and sees only their own progress. */}
              <Route path="/o/:slug" element={<OnboardingPortal />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/email-accounts" element={<EmailAccounts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/unibox" element={<Unibox />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/personalizacion" element={<Personalizacion />} />
                <Route path="/deliverability" element={<DeliverabilityTest />} />
                <Route path="/ai-prompts" element={<AIPrompts />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/community" element={<Community />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/client-campaigns" element={<ClientCampaigns />} />
                <Route path="/automatizacion" element={<AutomationFlow />} />
                <Route path="/seguimiento" element={<Seguimiento />} />
                <Route path="/godtube" element={<GodTube />} />
                <Route path="/partners" element={<Partners />} />
                <Route path="/admin" element={<AdminPanel />} />
                <Route path="/admin/clients" element={<ClientPortal />} />
                <Route path="/metrics" element={<Metrics />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <Suspense fallback={null}>
            <ColdEmailChatbot />
          </Suspense>
        </VerificationProvider>
        </ProfileProvider>
        </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
