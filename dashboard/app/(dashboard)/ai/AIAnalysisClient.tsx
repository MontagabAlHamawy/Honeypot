"use client";
// PATH: dashboard/app/(dashboard)/ai/AIAnalysisClient.tsx

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Brain,
  Shield,
  AlertTriangle,
  Zap,
  Send,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  Map,
  Lightbulb,
  Activity,
  TrendingUp,
  CheckCircle,
  XCircle,
  Loader2,
  MessageSquare,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AttackPattern {
  pattern: string;
  description: string;
  frequency: number;
  severity: string;
  indicators: string[];
}

interface Threat {
  threat: string;
  detail: string;
  affectedEndpoints: string[];
  severity: string;
}

interface Recommendation {
  priority: string;
  category: string;
  title: string;
  description: string;
  implementation: string;
}

interface Mitigation {
  attackType: string;
  mitigation: string;
  codeExample?: string;
  urgency: string;
}

interface GeoInsight {
  country: string;
  threatLevel: string;
  note: string;
}

interface AnalysisResult {
  summary?: string;
  riskScore?: number;
  riskLevel?: string;
  attackPatterns?: AttackPattern[];
  topThreats?: Threat[];
  behaviorAnalysis?: string;
  toolsAnalysis?: string;
  geoInsights?: GeoInsight[];
  recommendations?: Recommendation[];
  mitigations?: Mitigation[];
  conclusionAr?: string;
  attackCount?: number;
  sessionCount?: number;
  requestCount?: number;
  hoursBack?: number;
  analyzedAt?: string;
  tokensUsed?: number;
  error?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

type UiLanguage = "ar" | "en";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

const PRIORITY_STYLES: Record<string, string> = {
  immediate: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

const URGENCY_ICON: Record<string, React.ReactNode> = {
  immediate: <XCircle className="w-3 h-3 text-red-400" />,
  soon: <AlertTriangle className="w-3 h-3 text-orange-400" />,
  planned: <CheckCircle className="w-3 h-3 text-blue-400" />,
};

function RiskGauge({ score }: { score: number }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const color =
    clampedScore >= 75
      ? "#ef4444"
      : clampedScore >= 50
      ? "#f97316"
      : clampedScore >= 25
      ? "#eab308"
      : "#22c55e";

  const cx = 90;
  const cy = 90;
  const r = 70;
  const startAngle = -220;
  const endAngle = 40;
  const totalAngle = endAngle - startAngle;
  const valueAngle = startAngle + (totalAngle * clampedScore) / 100;

  function polar(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  const trackStart = polar(startAngle, r);
  const trackEnd = polar(endAngle, r);
  const valueEnd = polar(valueAngle, r);
  const largeArc = totalAngle > 180 ? 1 : 0;
  const largeArcValue =
    (valueAngle - startAngle) > 180 ? 1 : 0;

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="110" viewBox="0 0 180 120">
        {/* Track */}
        <path
          d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArc} 1 ${trackEnd.x} ${trackEnd.y}`}
          fill="none"
          stroke="hsl(222 20% 14%)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* Value arc */}
        {clampedScore > 0 && (
          <path
            d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArcValue} 1 ${valueEnd.x} ${valueEnd.y}`}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
          />
        )}
        {/* Score text */}
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          fill={color}
          fontSize="28"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {clampedScore}
        </text>
        <text
          x={cx}
          y={cy + 24}
          textAnchor="middle"
          fill="hsl(210 20% 50%)"
          fontSize="11"
          fontFamily="monospace"
        >
          / 100
        </text>
      </svg>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium border ${
        SEVERITY_STYLES[severity?.toLowerCase()] || SEVERITY_STYLES.low
      }`}
    >
      {severity?.toUpperCase()}
    </span>
  );
}

function MarkdownText({ text }: { text: string }) {
  // Simple markdown renderer for code blocks and bold
  const lines = text.split("\n");
  let inCode = false;
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      inCode = !inCode;
      return;
    }
    if (inCode) {
      elements.push(
        <code key={i} className="block font-mono text-xs text-green-300 bg-black/30 px-3 py-0.5">
          {line}
        </code>
      );
      return;
    }
    if (line.startsWith("### ")) {
      elements.push(<p key={i} className="font-semibold text-foreground mt-2">{line.slice(4)}</p>);
      return;
    }
    if (line.startsWith("## ")) {
      elements.push(<p key={i} className="font-bold text-foreground mt-2 text-base">{line.slice(3)}</p>);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={i} className="flex gap-2 items-start text-sm leading-relaxed">
          <span className="text-primary mt-1 shrink-0">•</span>
          <span>{line.slice(2)}</span>
        </li>
      );
      return;
    }
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1" />);
      return;
    }
    // Bold
    const boldProcessed = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={j} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>
      ) : (
        <span key={j}>{part}</span>
      )
    );
    elements.push(<p key={i} className="text-sm leading-relaxed">{boldProcessed}</p>);
  });

  return <div className="space-y-0.5 text-muted-foreground">{elements}</div>;
}

const RTL_CHAR_REGEX = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

function getTextDirection(text: string) {
  return RTL_CHAR_REGEX.test(text) ? "rtl" : "ltr";
}

function getUiText(language: UiLanguage) {
  return {
    headerTitle: language === "ar" ? "ذكاء أمني" : "AI Security Intelligence",
    headerSubtitle: language === "ar"
      ? "مدعوم بواسطة AI — HoneyShield v1.0"
      : "Powered by DeepSeek — HoneyShield v1.0",
    tabAnalysis: language === "ar" ? "تحليل أمني" : "Security Analysis",
    tabChat: language === "ar" ? "محادثة AI" : "AI Chat",
    periodLabel: language === "ar" ? "فترة التحليل:" : "Analysis period:",
    analyzeNow: language === "ar" ? "تحليل الآن" : "Analyze now",
    analyzing: language === "ar" ? "جاري التحليل..." : "Analyzing...",
    analysisEmptyTitle: language === "ar" ? "لا توجد هجمات مسجّلة" : "No attacks detected",
    analysisEmptyBody: language === "ar"
      ? "لم يتم رصد أي هجمات في آخر"
      : "No attacks were detected in the last",
    statAttacks: language === "ar" ? "إجمالي الهجمات" : "Total attacks",
    statSessions: language === "ar" ? "الجلسات المرصودة" : "Observed sessions",
    statRequests: language === "ar" ? "إجمالي الطلبات" : "Total requests",
    statPatterns: language === "ar" ? "أنماط مكتشفة" : "Patterns detected",
    riskScore: language === "ar" ? "درجة الخطر" : "Risk score",
    summaryTitle: language === "ar" ? "الملخص التنفيذي" : "Executive summary",
    behaviorTitle: language === "ar" ? "التحليل السلوكي" : "Behavioral analysis",
    patternsTitle: language === "ar" ? "أنماط الهجوم المكتشفة" : "Detected attack patterns",
    threatsTitle: language === "ar" ? "أبرز التهديدات" : "Top threats",
    recommendationsTitle: language === "ar" ? "التوصيات الأمنية" : "Security recommendations",
    mitigationsTitle: language === "ar" ? "حلول سد الثغرات" : "Mitigation playbook",
    geoTitle: language === "ar" ? "التوزيع الجغرافي للتهديدات" : "Geographic threat distribution",
    toolsTitle: language === "ar" ? "تحليل أدوات الهجوم" : "Attack tools analysis",
    conclusionTitle: language === "ar" ? "الخلاصة والتقييم العام" : "Final conclusion",
    implementationLabel: language === "ar" ? "خطوات التطبيق" : "Implementation",
    frequencyLabel: language === "ar" ? "تكرار" : "Frequency",
    welcomeTitle: language === "ar" ? "مساعد HoneyShield" : "HoneyShield AI Assistant",
    welcomeBody: language === "ar"
      ? "اسألني عن أي شيء متعلق بأمن النظام، تحليل الهجمات، أو كيفية تعزيز حمايتك. لديّ سياق كامل عن الهجمات المكتشفة في وقت الفعلي."
      : "Ask me anything about system security, attack analysis, or how to improve your defenses. I have live context from the latest detections.",
    clearChat: language === "ar" ? "مسح المحادثة" : "Clear chat",
    inputPlaceholder: language === "ar"
      ? "اسأل عن الهجمات، الثغرات، أو الحلول الأمنية..."
      : "Ask about attacks, vulnerabilities, or security fixes...",
    enterHint: language === "ar"
      ? "Enter للإرسال · Shift+Enter لسطر جديد"
      : "Enter to send · Shift+Enter for new line",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function AIAnalysisClient() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoursBack, setHoursBack] = useState(24);
  const [activeTab, setActiveTab] = useState<"analysis" | "chat">("analysis");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["patterns", "threats", "recommendations"])
  );
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("en");
  const [languageReady, setLanguageReady] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const uiText = getUiText(uiLanguage);

  const analysisCacheKey = useCallback(
    (hours: number, lang: UiLanguage) => `ai-analysis:${hours}:${lang}`,
    []
  );

  const readCachedAnalysis = useCallback(
    (hours: number, lang: UiLanguage) => {
      try {
        const raw = sessionStorage.getItem(analysisCacheKey(hours, lang));
        if (!raw) return null;
        return JSON.parse(raw) as { data: AnalysisResult; cachedAt: string };
      } catch {
        return null;
      }
    },
    [analysisCacheKey]
  );

  const writeCachedAnalysis = useCallback(
    (hours: number, lang: UiLanguage, data: AnalysisResult) => {
      try {
        sessionStorage.setItem(
          analysisCacheKey(hours, lang),
          JSON.stringify({ data, cachedAt: new Date().toISOString() })
        );
      } catch {
        // ignore cache write failures
      }
    },
    [analysisCacheKey]
  );

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // ── Auto-analyze on mount ──
  const runAnalysis = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const cached = readCachedAnalysis(hoursBack, uiLanguage);
      if (cached) {
        setAnalysis(cached.data);
        return;
      }
    }

    setLoading(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursBack, language: uiLanguage }),
      });
      const data = await res.json();
      setAnalysis(data);
      writeCachedAnalysis(hoursBack, uiLanguage, data);
    } catch {
      setAnalysis({
        error: uiLanguage === "ar" ? "فشل الاتصال بالخادم" : "Connection failed",
      });
    } finally {
      setLoading(false);
    }
  }, [hoursBack, readCachedAnalysis, uiLanguage, writeCachedAnalysis]);

  useEffect(() => {
    const stored = sessionStorage.getItem("ai-language");
    if (stored === "ar" || stored === "en") {
      setUiLanguage(stored);
    }
    setLanguageReady(true);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("ai-language", uiLanguage);
  }, [uiLanguage]);

  useEffect(() => {
    if (!languageReady) return;
    runAnalysis();
  }, [hoursBack, languageReady, uiLanguage, runAnalysis]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  // ── Chat submit ──
  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setChatInput("");
    setChatLoading(true);

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          preferredLanguage: uiLanguage,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream error");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content:
            uiLanguage === "ar"
              ? "⚠️ حدث خطأ أثناء الاتصال. حاول مرة أخرى."
              : "⚠️ A connection error occurred. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const QUICK_QUESTIONS = {
    ar: [
      "ما هي أخطر الهجمات المكتشفة اليوم؟",
      "كيف أحمي WordPress من SQL Injection؟",
      "ما هي أدوات WAF الموصى بها؟",
      "اشرح لي تقنية Brute Force المستخدمة",
    ],
    en: [
      "What are the most critical attacks detected today?",
      "How can I protect WordPress from SQL Injection?",
      "Which WAF tools do you recommend?",
      "Explain the Brute Force technique used",
    ],
  };

  return (
    <div
      className={`min-h-screen bg-background ${
        uiLanguage === "ar" ? "font-['Cairo']" : ""
      }`}
    >
      {/* ── Header ── */}
      <div className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-30">
        <div className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground">
                {uiText.headerTitle}
              </h1>
              <p className="text-xs text-muted-foreground font-mono">
                {uiText.headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:justify-end">
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
              {(["en", "ar"] as UiLanguage[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setUiLanguage(lang)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all uppercase tracking-wide ${
                    uiLanguage === lang
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 overflow-x-auto max-w-full">
              <button
                onClick={() => setActiveTab("analysis")}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "analysis"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                {uiText.tabAnalysis}
              </button>
              <button
                onClick={() => setActiveTab("chat")}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "chat"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {uiText.tabChat}
                {messages.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-primary/20 text-primary rounded-full text-[10px]">
                    {messages.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          TAB: ANALYSIS
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "analysis" && (
        <div className="p-3 sm:p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{uiText.periodLabel}</span>
              {[6, 12, 24, 48, 72].map((h) => (
                <button
                  key={h}
                  onClick={() => setHoursBack(h)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                    hoursBack === h
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            <button
              onClick={() => runAnalysis({ force: true })}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {loading ? uiText.analyzing : uiText.analyzeNow}
            </button>
            {analysis && !loading && (
              <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-primary" />
                {new Date(analysis.analyzedAt!).toLocaleTimeString(
                  uiLanguage === "ar" ? "ar-SA" : "en-US"
                )}
                {analysis.tokensUsed ? ` · ${analysis.tokensUsed} tokens` : ""}
              </span>
            )}
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
                ))}
              </div>
              <div className="h-48 bg-card border border-border rounded-xl animate-pulse" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-64 bg-card border border-border rounded-xl animate-pulse" />
                <div className="h-64 bg-card border border-border rounded-xl animate-pulse" />
              </div>
            </div>
          )}

          {/* Error */}
          {!loading && analysis?.error && (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-sm">
              <XCircle className="w-5 h-5 shrink-0" />
              {analysis.error}
            </div>
          )}

          {/* No attacks */}
          {!loading && analysis && !analysis.error && analysis.attackCount === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <p className="text-foreground font-medium">{uiText.analysisEmptyTitle}</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {uiText.analysisEmptyBody} {hoursBack} {uiLanguage === "ar" ? "ساعة" : "hours"}.
                {uiLanguage === "ar" ? " النظام يعمل بشكل طبيعي." : " The system is operating normally."}
              </p>
            </div>
          )}

          {/* ── Results ── */}
          {!loading && analysis && !analysis.error && analysis.attackCount! > 0 && (
            <div className="space-y-5">

              {/* Stat cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: uiText.statAttacks,
                    value: analysis.attackCount,
                    icon: <AlertTriangle className="w-4 h-4" />,
                    color: "text-orange-400",
                    bg: "bg-orange-400/10",
                  },
                  {
                    label: uiText.statSessions,
                    value: analysis.sessionCount,
                    icon: <Activity className="w-4 h-4" />,
                    color: "text-blue-400",
                    bg: "bg-blue-400/10",
                  },
                  {
                    label: uiText.statRequests,
                    value: analysis.requestCount?.toLocaleString(),
                    icon: <Zap className="w-4 h-4" />,
                    color: "text-yellow-400",
                    bg: "bg-yellow-400/10",
                  },
                  {
                    label: uiText.statPatterns,
                    value: analysis.attackPatterns?.length ?? 0,
                    icon: <Target className="w-4 h-4" />,
                    color: "text-primary",
                    bg: "bg-primary/10",
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="bg-card border border-border rounded-xl p-4 flex items-center gap-3"
                  >
                    <div
                      className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center ${card.color}`}
                    >
                      {card.icon}
                    </div>
                    <div>
                      <div className={`text-xl font-bold font-mono ${card.color}`}>
                        {card.value}
                      </div>
                      <div className="text-xs text-muted-foreground">{card.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Risk Score + Summary */}
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="bg-card border border-border rounded-xl p-5 flex flex-col items-center justify-center gap-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    {uiText.riskScore}
                  </p>
                  <RiskGauge score={analysis.riskScore ?? 0} />
                  <SeverityBadge severity={analysis.riskLevel ?? "low"} />
                </div>
                <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Brain className="w-4 h-4 text-primary" />
                    {uiText.summaryTitle}
                  </div>
                  <p
                    className={`text-sm leading-relaxed text-muted-foreground ${
                      uiLanguage === "ar" ? "text-right" : "text-left"
                    }`}
                    dir={uiLanguage === "ar" ? "rtl" : "ltr"}
                  >
                    {analysis.summary}
                  </p>
                  {analysis.behaviorAnalysis && (
                    <>
                      <div className="border-t border-border pt-3 flex items-center gap-2 text-sm font-medium text-foreground">
                        <Activity className="w-4 h-4 text-primary" />
                        {uiText.behaviorTitle}
                      </div>
                      <p
                        className={`text-sm leading-relaxed text-muted-foreground ${
                          uiLanguage === "ar" ? "text-right" : "text-left"
                        }`}
                        dir={uiLanguage === "ar" ? "rtl" : "ltr"}
                      >
                        {analysis.behaviorAnalysis}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Attack Patterns */}
              {(analysis.attackPatterns?.length ?? 0) > 0 && (
                <Section
                  id="patterns"
                  icon={<Target className="w-4 h-4 text-primary" />}
                  title={`${uiText.patternsTitle} (${analysis.attackPatterns!.length})`}
                  expanded={expandedSections.has("patterns")}
                  onToggle={() => toggleSection("patterns")}
                >
                  <div className="grid md:grid-cols-2 gap-3">
                    {analysis.attackPatterns!.map((p, i) => (
                      <div
                        key={i}
                        className="border border-border rounded-lg p-4 space-y-2 hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{p.pattern}</span>
                          <SeverityBadge severity={p.severity} />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">
                            {uiText.frequencyLabel}:{" "}
                            <span className="font-mono text-primary font-medium">{p.frequency}</span>
                          </span>
                        </div>
                        {p.indicators?.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {p.indicators.map((ind, j) => (
                              <span
                                key={j}
                                className="px-2 py-0.5 bg-secondary text-muted-foreground rounded text-[11px] font-mono"
                              >
                                {ind}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Top Threats */}
              {(analysis.topThreats?.length ?? 0) > 0 && (
                <Section
                  id="threats"
                  icon={<AlertTriangle className="w-4 h-4 text-orange-400" />}
                  title={`${uiText.threatsTitle} (${analysis.topThreats!.length})`}
                  expanded={expandedSections.has("threats")}
                  onToggle={() => toggleSection("threats")}
                >
                  <div className="space-y-3">
                    {analysis.topThreats!.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-4 p-4 border border-border rounded-lg hover:border-orange-500/20 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 font-mono text-xs text-orange-400 font-bold">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">{t.threat}</span>
                            <SeverityBadge severity={t.severity} />
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{t.detail}</p>
                          {t.affectedEndpoints?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {t.affectedEndpoints.map((ep, j) => (
                                <span
                                  key={j}
                                  className="px-2 py-0.5 bg-orange-500/5 border border-orange-500/20 text-orange-400 rounded text-[11px] font-mono"
                                >
                                  {ep}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Recommendations */}
              {(analysis.recommendations?.length ?? 0) > 0 && (
                <Section
                  id="recommendations"
                  icon={<Lightbulb className="w-4 h-4 text-yellow-400" />}
                  title={`${uiText.recommendationsTitle} (${analysis.recommendations!.length})`}
                  expanded={expandedSections.has("recommendations")}
                  onToggle={() => toggleSection("recommendations")}
                >
                  <div className="space-y-3">
                    {analysis.recommendations!.map((r, i) => (
                      <div
                        key={i}
                        className="border border-border rounded-lg overflow-hidden hover:border-yellow-500/20 transition-colors"
                      >
                        <div className="flex items-center gap-3 p-4 border-b border-border/50 bg-secondary/30">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium border ${
                              PRIORITY_STYLES[r.priority?.toLowerCase()] ||
                              PRIORITY_STYLES.low
                            }`}
                          >
                            {r.priority?.toUpperCase()}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            [{r.category}]
                          </span>
                          <span className="text-sm font-medium text-foreground">{r.title}</span>
                        </div>
                        <div className="p-4 space-y-2">
                          <p className="text-xs text-muted-foreground leading-relaxed">{r.description}</p>
                          {r.implementation && (
                            <div className="bg-black/20 rounded-lg p-3">
                              <p className="text-xs text-muted-foreground/70 mb-1 font-mono uppercase tracking-wider">
                                {uiText.implementationLabel}
                              </p>
                              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono">
                                {r.implementation}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Mitigations */}
              {(analysis.mitigations?.length ?? 0) > 0 && (
                <Section
                  id="mitigations"
                  icon={<Shield className="w-4 h-4 text-primary" />}
                  title={`${uiText.mitigationsTitle} (${analysis.mitigations!.length})`}
                  expanded={expandedSections.has("mitigations")}
                  onToggle={() => toggleSection("mitigations")}
                >
                  <div className="grid md:grid-cols-2 gap-3">
                    {analysis.mitigations!.map((m, i) => (
                      <div key={i} className="border border-border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{m.attackType}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {URGENCY_ICON[m.urgency]}
                            {m.urgency}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{m.mitigation}</p>
                        {m.codeExample && (
                          <pre className="bg-black/30 rounded-lg p-3 text-xs font-mono text-green-300 overflow-x-auto whitespace-pre-wrap break-all">
                            {m.codeExample}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Geo Insights */}
              {(analysis.geoInsights?.length ?? 0) > 0 && (
                <Section
                  id="geo"
                  icon={<Map className="w-4 h-4 text-blue-400" />}
                  title={uiText.geoTitle}
                  expanded={expandedSections.has("geo")}
                  onToggle={() => toggleSection("geo")}
                >
                  <div className="flex flex-wrap gap-3">
                    {analysis.geoInsights!.map((g, i) => (
                      <div
                        key={i}
                        className={`w-full sm:w-auto flex items-start gap-3 p-3 border rounded-lg sm:min-w-[220px] ${
                          SEVERITY_STYLES[g.threatLevel?.toLowerCase()] ||
                          SEVERITY_STYLES.low
                        }`}
                      >
                        <div className="text-lg">🌍</div>
                        <div>
                          <p className="text-sm font-medium">{g.country}</p>
                          <p className="text-xs opacity-80 mt-0.5">{g.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Tools Analysis */}
              {analysis.toolsAnalysis && (
                <div className="bg-card border border-border rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Zap className="w-4 h-4 text-primary" />
                    {uiText.toolsTitle}
                  </div>
                  <p
                    className={`text-sm text-muted-foreground leading-relaxed ${
                      uiLanguage === "ar" ? "text-right" : "text-left"
                    }`}
                    dir={uiLanguage === "ar" ? "rtl" : "ltr"}
                  >
                    {analysis.toolsAnalysis}
                  </p>
                </div>
              )}

              {/* Conclusion */}
              {analysis.conclusionAr && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <CheckCircle className="w-4 h-4" />
                    {uiText.conclusionTitle}
                  </div>
                  <p
                    className={`text-sm text-muted-foreground leading-relaxed ${
                      uiLanguage === "ar" ? "text-right" : "text-left"
                    }`}
                    dir={uiLanguage === "ar" ? "rtl" : "ltr"}
                  >
                    {analysis.conclusionAr}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: CHAT
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "chat" && (
        <div className="flex flex-col min-h-[70vh] h-[calc(100dvh-11rem)] sm:h-[calc(100dvh-10rem)]">

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4 max-w-4xl mx-auto w-full">

            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-bold text-foreground">
                    {uiText.welcomeTitle}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {uiText.welcomeBody}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {QUICK_QUESTIONS[uiLanguage].map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setChatInput(q);
                        inputRef.current?.focus();
                      }}
                      className={`px-3 py-2.5 bg-card border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all leading-relaxed ${
                        uiLanguage === "ar" ? "text-right" : "text-left"
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation */}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    msg.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-secondary border border-border"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-4 h-4 text-primary" />
                  ) : (
                    <Bot className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={`group max-w-[92%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-3 space-y-1 relative ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-card border border-border rounded-tl-sm"
                  }`}
                >
                  {msg.role === "user" ? (
                    <p
                      className={`text-sm leading-relaxed ${
                        getTextDirection(msg.content) === "rtl" ? "text-right" : "text-left"
                      }`}
                      dir={getTextDirection(msg.content)}
                    >
                      {msg.content}
                    </p>
                  ) : (
                    <div className="text-sm leading-relaxed">
                      {msg.content ? (
                        <div
                          dir={getTextDirection(msg.content)}
                          className={
                            getTextDirection(msg.content) === "rtl" ? "text-right" : "text-left"
                          }
                        >
                          <MarkdownText text={msg.content} />
                        </div>
                      ) : (
                        <div className="flex gap-1 items-center py-1">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Copy button */}
                  {msg.content && msg.role === "assistant" && (
                    <button
                      onClick={() => copyMessage(msg.content, idx)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary"
                    >
                      {copiedIdx === idx ? (
                        <Check className="w-3 h-3 text-primary" />
                      ) : (
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      )}
                    </button>
                  )}

                  <p
                    className={`text-[10px] font-mono ${
                      msg.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground/50"
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString(
                      uiLanguage === "ar" ? "ar-SA" : "en-US",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border bg-card/80 backdrop-blur p-3 sm:p-4">
            <div className="max-w-4xl mx-auto flex items-end gap-2 sm:gap-3">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  title={uiText.clearChat}
                  className="p-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={uiText.inputPlaceholder}
                  rows={1}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-['IBM_Plex_Sans'] leading-relaxed"
                  style={{
                    minHeight: "48px",
                    maxHeight: "140px",
                    height: "auto",
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 140) + "px";
                  }}
                  disabled={chatLoading}
                />
              </div>
              <button
                onClick={sendMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="p-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {chatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-center text-[11px] text-muted-foreground/50 mt-2 font-mono">
              {uiText.enterHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Accordion Component
// ─────────────────────────────────────────────────────────────────────────────
function Section({
  id,
  icon,
  title,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          {title}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="p-4 pt-0 border-t border-border/50">{children}</div>
      )}
    </div>
  );
}
