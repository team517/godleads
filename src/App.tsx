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
import { lazy, Suspense } from "react";
import { ColdEmailChatbot } from "@/components/ColdEmailChatbot";

const Landing = lazy(() => import("./pages/Landing"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const EmailAccounts = lazy(() => import("./pages/EmailAccounts"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const Leads = lazy(() => import("./pages/Leads"));
const Unibox = lazy(() => import("./pages/Unibox"));
const Stats = lazy(() => import("./pages/Stats"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AIPrompts = lazy(() => import("./pages/AIPrompts"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Install = lazy(() => import("./pages/Install"));
const Community = lazy(() => import("./pages/Community"));
const Workflows = lazy(() => import("./pages/Workflows"));
const GodTube = lazy(() => import("./pages/GodTube"));
const Partners = lazy(() => import("./pages/Partners"));
const Metrics = lazy(() => import("./pages/Metrics"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const App = () => (
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
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/email-accounts" element={<EmailAccounts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/unibox" element={<Unibox />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/ai-prompts" element={<AIPrompts />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/community" element={<Community />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/godtube" element={<GodTube />} />
                <Route path="/partners" element={<Partners />} />
                <Route path="/admin" element={<AdminPanel />} />
                <Route path="/metrics" element={<Metrics />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <ColdEmailChatbot />
        </VerificationProvider>
        </ProfileProvider>
        </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
