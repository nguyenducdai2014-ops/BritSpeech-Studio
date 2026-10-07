import React, { useState, useRef, useEffect } from "react";
import { 
  BookOpen, 
  MessageSquare, 
  Volume2, 
  Download, 
  Play, 
  Pause, 
  RotateCcw, 
  Sparkles, 
  Mic, 
  User, 
  Users, 
  Clock, 
  Library, 
  Sliders, 
  CheckCircle2, 
  AlertCircle,
  Headphones,
  FileText,
  RefreshCw
} from "lucide-react";

interface VoiceOption {
  key: string;
  name: string;
  role: string;
  desc: string;
  accent: string;
}

const VOICES: VoiceOption[] = [
  { key: "oliver", name: "Oliver", role: "Teen Boy", desc: "Youthful, energetic British teenage voice", accent: "RP British Teen" },
  { key: "mia", name: "Mia", role: "Teen Girl", desc: "Bright, expressive British teenage voice", accent: "London Teen" },
  { key: "arthur", name: "Arthur", role: "Adult Male", desc: "Distinguished, warm, articulate British adult male", accent: "Received Pronunciation" },
  { key: "victoria", name: "Victoria", role: "Adult Female", desc: "Elegant, professional, polished British adult female", accent: "Standard British" }
];

const READING_TOPICS = [
  "British Royal History & Castles",
  "A Stroll Through Victorian London",
  "The Wonders of Scottish Highlands",
  "Modern British Tea Culture & Etiquette",
  "Science in the UK: From Newton to Modern Tech",
  "Shakespeare's Globe and Elizabethan Theatre"
];

const DIALOGUE_SCENARIOS = [
  "Ordering Afternoon Tea at a Traditional Cafe",
  "Planning a Weekend Road Trip to the Cotswolds",
  "Job Interview at a Creative Agency in Shoreditch",
  "Discussing Contemporary Art at the Tate Modern",
  "Chatting about Hobbies, Sports and School Life",
  "Asking for Directions and Exploring the Underground"
];

interface GeneratedItem {
  id: string;
  type: "reading" | "dialogue";
  title: string;
  audioBase64: string;
  createdAt: string;
  voiceLabel?: string;
  speaker1?: string;
  speaker2?: string;
  speaker3?: string;
  text?: string;
  dialogueTurns?: { speaker: string; text: string }[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"reading" | "dialogue" | "library">("reading");

  // API Key Gate State
  const [apiKey, setApiKey] = useState<string>(() => {
    const saved = localStorage.getItem("brit_gemini_api_key") || "";
    if (saved && !localStorage.getItem("brit_gemini_verified")) {
      localStorage.setItem("brit_gemini_verified", "true");
    }
    return saved;
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(() => {
    const saved = localStorage.getItem("brit_gemini_api_key");
    const verified = localStorage.getItem("brit_gemini_verified");
    return !saved || verified !== "true";
  });
  const [keyInput, setKeyInput] = useState<string>("");
  const [keyValidating, setKeyValidating] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) {
      setKeyError("Please enter a valid Gemini API Key.");
      return;
    }
    setKeyValidating(true);
    setKeyError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyInput.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Invalid or unauthorized Gemini API key.");
      }
      localStorage.setItem("brit_gemini_api_key", keyInput.trim());
      localStorage.setItem("brit_gemini_verified", "true");
      setApiKey(keyInput.trim());
      setShowApiKeyModal(false);
      setKeyInput("");
    } catch (err: any) {
      clearTimeout(timeoutId);
      let errorMsg = err.message || "";
      if (err.name === "AbortError" || errorMsg.includes("aborted") || errorMsg.includes("Timeout")) {
        errorMsg = "Gemini validation timed out. Please try again.";
      } else if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("network")) {
        errorMsg = "Unable to connect to Gemini. Please check your internet connection.";
      } else if (!errorMsg) {
        errorMsg = "Invalid or unauthorized Gemini API key.";
      }
      setKeyError(errorMsg);
    } finally {
      setKeyValidating(false);
    }
  };

  const handleRemoveApiKey = () => {
    localStorage.removeItem("brit_gemini_api_key");
    localStorage.removeItem("brit_gemini_verified");
    setApiKey("");
    setKeyInput("");
    setKeyError(null);
    setShowApiKeyModal(true);
  };

  // Reading Flow State
  const [readingTopic, setReadingTopic] = useState(READING_TOPICS[0]);
  const [customReadingText, setCustomReadingText] = useState("");
  const [readingVoice, setReadingVoice] = useState("arthur");
  const [readingLevel, setReadingLevel] = useState("B1-B2");
  const [isGeneratingReading, setIsGeneratingReading] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [currentReadingResult, setCurrentReadingResult] = useState<GeneratedItem | null>(null);

  // Dialogue Flow State
  const [dialogueScenario, setDialogueScenario] = useState(DIALOGUE_SCENARIOS[0]);
  const [speaker1Key, setSpeaker1Key] = useState("arthur");
  const [speaker2Key, setSpeaker2Key] = useState("victoria");
  const [dialogueLevel, setDialogueLevel] = useState("B1-B2");
  const [customDialogueScript, setCustomDialogueScript] = useState("");
  const [isGeneratingDialogue, setIsGeneratingDialogue] = useState(false);
  const [currentDialogueResult, setCurrentDialogueResult] = useState<GeneratedItem | null>(null);

  // Library / History
  const [libraryItems, setLibraryItems] = useState<GeneratedItem[]>([]);

  // Active Audio Player State
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Handle Audio Playback
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const playAudio = (item: GeneratedItem) => {
    if (playingItemId === item.id && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    const wavBlob = base64ToWavBlob(item.audioBase64);
    const audioUrl = URL.createObjectURL(wavBlob);
    audioUrlRef.current = audioUrl;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.playbackRate = playbackRate;

    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      setIsPlaying(false);
      setPlayingItemId(null);
      setCurrentTime(0);
    };

    audio.play();
    setPlayingItemId(item.id);
    setIsPlaying(true);
  };

  const base64ToWavBlob = (base64: string): Blob => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: "audio/wav" });
  };

  const downloadAudio = (item: GeneratedItem) => {
    const blob = base64ToWavBlob(item.audioBase64);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.title.toLowerCase().replace(/[^a-z0-9]/g, "_")}_british_speech.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBrowserSpeechFallback = (textToSpeak: string) => {
    if (!('speechSynthesis' in window)) {
      alert("Browser Speech Synthesis is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'en-GB';
    const voices = window.speechSynthesis.getVoices();
    const ukVoice = voices.find(v => v.lang.includes('GB') || v.lang.includes('en-GB') || v.name.includes('British') || v.name.includes('UK') || v.name.includes('English'));
    if (ukVoice) {
      utterance.voice = ukVoice;
    }
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
  };

  // Generate Reading Flow
  const handleGenerateReading = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }
    setReadingError(null);
    setIsGeneratingReading(true);
    try {
      const res = await fetch("/api/generate-reading", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Gemini-ApiKey": apiKey } : {}),
        },
        body: JSON.stringify({
          topic: readingTopic,
          level: readingLevel,
          customText: customReadingText,
          voiceKey: readingVoice,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to generate reading audio.");

      const newItem: GeneratedItem = {
        id: "read_" + Date.now(),
        type: "reading",
        title: data.title,
        text: data.text,
        audioBase64: data.audioBase64,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        voiceLabel: data.voice,
      };

      setCurrentReadingResult(newItem);
      setLibraryItems((prev) => [newItem, ...prev]);
      playAudio(newItem);
    } catch (err: any) {
      console.error("Error generating reading audio:", err);
      setReadingError(err.message || "Reading audio generation failed.");
    } finally {
      setIsGeneratingReading(false);
    }
  };

  // Generate Dialogue Flow
  const handleGenerateDialogue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }
    if (speaker1Key === speaker2Key) {
      alert("Please select two different voice personas for the dialogue.");
      return;
    }
    setIsGeneratingDialogue(true);
    try {
      let parsedCustomScript = undefined;
      if (customDialogueScript.trim()) {
        // Parse simple text script if provided
        parsedCustomScript = customDialogueScript.split("\n").map(line => {
          const parts = line.split(":");
          if (parts.length >= 2) {
            return { speaker: parts[0].trim(), text: parts.slice(1).join(":").trim() };
          }
          return { speaker: "Speaker", text: line.trim() };
        }).filter(t => t.text.length > 0);
      }

      const res = await fetch("/api/generate-dialogue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Gemini-ApiKey": apiKey } : {}),
        },
        body: JSON.stringify({
          topic: dialogueScenario,
          speaker1Key,
          speaker2Key,
          level: dialogueLevel,
          customScript: parsedCustomScript,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const newItem: GeneratedItem = {
        id: "dial_" + Date.now(),
        type: "dialogue",
        title: data.title,
        dialogueTurns: data.dialogueTurns,
        audioBase64: data.audioBase64,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        speaker1: data.speaker1,
        speaker2: data.speaker2,
      };

      setCurrentDialogueResult(newItem);
      setLibraryItems((prev) => [newItem, ...prev]);
      playAudio(newItem);
    } catch (err: any) {
      alert("Error generating dialogue audio: " + err.message);
    } finally {
      setIsGeneratingDialogue(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col antialiased">
      {/* Top Bar Contract (Zone 1: Brand, Zone 2: Nav, Zone 3: Actions) */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        {/* Zone 1: Single text wordmark */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-200">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">BritSpeech Studio</h1>
            <p className="text-xs text-slate-500 font-medium">British English TTS & Dialogue Audio Generator</p>
            <p className="text-[11px] text-slate-400 font-normal">Built by Nguyễn Đức Đại. GV THCS Đồng Tâm .</p>
          </div>
        </div>

        {/* Zone 2: Nav links */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab("reading")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === "reading" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Reading Flow (Bài đọc)</span>
          </button>
          <button
            onClick={() => setActiveTab("dialogue")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === "dialogue" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Dialogue Flow (Bài đối thoại)</span>
          </button>
          <button
            onClick={() => setActiveTab("library")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === "library" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Library className="w-4 h-4" />
            <span>Audio Library ({libraryItems.length})</span>
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all border border-slate-200 cursor-pointer"
            title="Configure Gemini API Key"
          >
            <span>🔐 API Key</span>
          </button>
          <span className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            British RP & Regional Voices Ready
          </span>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden flex border-b border-slate-200 bg-white">
        <button
          onClick={() => setActiveTab("reading")}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 ${
            activeTab === "reading" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-600"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Reading</span>
        </button>
        <button
          onClick={() => setActiveTab("dialogue")}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 ${
            activeTab === "dialogue" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-600"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Dialogue</span>
        </button>
        <button
          onClick={() => setActiveTab("library")}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 ${
            activeTab === "library" ? "border-indigo-600 text-indigo-600 bg-indigo-50/50" : "border-transparent text-slate-600"
          }`}
        >
          <Library className="w-4 h-4" />
          <span>Library ({libraryItems.length})</span>
        </button>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-8">
        {activeTab === "reading" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Configuration Form */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    01
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Reading Passage Studio</h2>
                    <p className="text-xs text-slate-500">Generate single-speaker British English reading audio</p>
                  </div>
                </div>

                <form onSubmit={handleGenerateReading} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Topic or Article Title
                    </label>
                    <select
                      value={readingTopic}
                      onChange={(e) => setReadingTopic(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {READING_TOPICS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Custom Text (Optional Override)
                    </label>
                    <textarea
                      rows={4}
                      value={customReadingText}
                      onChange={(e) => setCustomReadingText(e.target.value)}
                      placeholder="Paste your own British English reading text here (or leave blank to auto-generate based on topic)..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    ></textarea>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        Proficiency Level
                      </label>
                      <select
                        value={readingLevel}
                        onChange={(e) => setReadingLevel(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="A2">A2 Elementary</option>
                        <option value="B1">B1 Intermediate</option>
                        <option value="B1-B2">B1-B2 Upper Int</option>
                        <option value="C1">C1 Advanced</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        British Voice Persona
                      </label>
                      <select
                        value={readingVoice}
                        onChange={(e) => setReadingVoice(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {VOICES.map((v) => (
                          <option key={v.key} value={v.key}>{v.name} ({v.role})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isGeneratingReading}
                    className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
                  >
                    {isGeneratingReading ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Synthesizing British Speech...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Generate Reading Audio & Text</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Voice Info Cards */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Available British Voice Personas</h3>
                <div className="space-y-3">
                  {VOICES.map((v) => (
                    <div key={v.key} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                        {v.name[0]}
                      </div>
                      <div className="text-xs">
                        <div className="font-bold text-slate-900">{v.name} <span className="font-normal text-slate-500">· {v.role}</span></div>
                        <div className="text-slate-600 mt-0.5">{v.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Reading Output & Player */}
            <div className="lg:col-span-7 space-y-6">
              {isGeneratingReading ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-sm flex flex-col items-center justify-center min-h-[420px] space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center animate-spin">
                    <RefreshCw className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Generating British English reading audio...</h3>
                  <p className="text-sm text-slate-500 max-w-sm">
                    Synthesizing speech with your selected British voice persona. Please wait a moment.
                  </p>
                </div>
              ) : readingError ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-red-200 shadow-sm flex flex-col items-center justify-center min-h-[420px] space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Reading audio generation failed.</h3>
                  <p className="text-sm text-red-600 max-w-md bg-red-50 p-3 rounded-xl border border-red-100 font-mono text-xs">
                    {readingError}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => handleGenerateReading()}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Retry Generation</span>
                    </button>
                    {(readingError.includes("429") || readingError.includes("quota") || readingError.includes("RESOURCE_EXHAUSTED")) && (
                      <button
                        onClick={() => handleBrowserSpeechFallback(customReadingText || "London is a vibrant capital city combining centuries of history with cutting-edge modernity.")}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>Play Browser British Voice (Fallback)</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : currentReadingResult ? (
                <div className="bg-white rounded-2xl p-6 lg:p-8 border border-slate-200/80 shadow-sm space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <span>Reading Passage</span>
                        <span>·</span>
                        <span>{currentReadingResult.voiceLabel}</span>
                        <span>·</span>
                        <span>{currentReadingResult.createdAt}</span>
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">{currentReadingResult.title}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadAudio(currentReadingResult)}
                        className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download WAV</span>
                      </button>
                    </div>
                  </div>

                  {/* Audio Player Bar */}
                  <div className="bg-gradient-to-r from-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-lg space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => playAudio(currentReadingResult)}
                          className="w-12 h-12 rounded-full bg-white text-indigo-900 flex items-center justify-center hover:scale-105 transition-all shadow-md cursor-pointer"
                        >
                          {playingItemId === currentReadingResult.id && isPlaying ? (
                            <Pause className="w-6 h-6 fill-current" />
                          ) : (
                            <Play className="w-6 h-6 fill-current ml-0.5" />
                          )}
                        </button>
                        <div>
                          <div className="text-sm font-bold">{currentReadingResult.title}</div>
                          <div className="text-xs text-indigo-200">{currentReadingResult.voiceLabel}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {[0.75, 1, 1.25, 1.5].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => setPlaybackRate(rate)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                              playbackRate === rate ? "bg-indigo-500 text-white" : "bg-white/10 text-indigo-200 hover:bg-white/20"
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-400 h-full transition-all"
                          style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-indigo-200">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Article Text Content */}
                  <div className="prose prose-slate max-w-none">
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Article Transcript</h3>
                    <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/60 text-slate-800 leading-relaxed text-base font-serif whitespace-pre-line">
                      {currentReadingResult.text}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-sm flex flex-col items-center justify-center min-h-[420px]">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">No reading audio generated yet</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    Select a topic and a British voice persona on the left, then click generate to create your reading passage and studio-quality speech.
                  </p>
                  <button
                    onClick={() => handleGenerateReading()}
                    disabled={isGeneratingReading}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    Generate Sample Article Now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "dialogue" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Dialogue Config */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    02
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Dialogue & Screenplay Studio</h2>
                    <p className="text-xs text-slate-500">Multi-speaker conversational audio with 2 British voices</p>
                  </div>
                </div>

                <form onSubmit={handleGenerateDialogue} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Conversation Scenario
                    </label>
                    <select
                      value={dialogueScenario}
                      onChange={(e) => setDialogueScenario(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {DIALOGUE_SCENARIOS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        Speaker 1 Voice
                      </label>
                      <select
                        value={speaker1Key}
                        onChange={(e) => setSpeaker1Key(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {VOICES.map((v) => (
                          <option key={v.key} value={v.key}>{v.name} ({v.role})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        Speaker 2 Voice
                      </label>
                      <select
                        value={speaker2Key}
                        onChange={(e) => setSpeaker2Key(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {VOICES.map((v) => (
                          <option key={v.key} value={v.key}>{v.name} ({v.role})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Custom Script (Optional Format: Speaker: Line)
                    </label>
                    <textarea
                      rows={4}
                      value={customDialogueScript}
                      onChange={(e) => setCustomDialogueScript(e.target.value)}
                      placeholder="Arthur: Hello Victoria!&#10;Victoria: Hi Arthur, lovely day!"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                    ></textarea>
                  </div>

                  <button
                    type="submit"
                    disabled={isGeneratingDialogue}
                    className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
                  >
                    {isGeneratingDialogue ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Synthesizing Multi-Speaker Audio...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Generate Dialogue & Audio</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column: Dialogue Output & Player */}
            <div className="lg:col-span-7 space-y-6">
              {currentDialogueResult ? (
                <div className="bg-white rounded-2xl p-6 lg:p-8 border border-slate-200/80 shadow-sm space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                        <span>Dialogue Script</span>
                        <span>·</span>
                        <span>{currentDialogueResult.speaker1} & {currentDialogueResult.speaker2}</span>
                        <span>·</span>
                        <span>{currentDialogueResult.createdAt}</span>
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">{currentDialogueResult.title}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadAudio(currentDialogueResult)}
                        className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download WAV</span>
                      </button>
                    </div>
                  </div>

                  {/* Audio Player Bar */}
                  <div className="bg-gradient-to-r from-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-lg space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => playAudio(currentDialogueResult)}
                          className="w-12 h-12 rounded-full bg-white text-indigo-900 flex items-center justify-center hover:scale-105 transition-all shadow-md cursor-pointer"
                        >
                          {playingItemId === currentDialogueResult.id && isPlaying ? (
                            <Pause className="w-6 h-6 fill-current" />
                          ) : (
                            <Play className="w-6 h-6 fill-current ml-0.5" />
                          )}
                        </button>
                        <div>
                          <div className="text-sm font-bold">{currentDialogueResult.title}</div>
                          <div className="text-xs text-indigo-200">{currentDialogueResult.speaker1} & {currentDialogueResult.speaker2}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {[0.75, 1, 1.25, 1.5].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => setPlaybackRate(rate)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                              playbackRate === rate ? "bg-indigo-500 text-white" : "bg-white/10 text-indigo-200 hover:bg-white/20"
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-400 h-full transition-all"
                          style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-indigo-200">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Dialogue Transcript Turns */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Conversation Transcript</h3>
                    <div className="space-y-3 max-h-[450px] overflow-y-auto pr-2">
                      {currentDialogueResult.dialogueTurns?.map((turn, idx) => (
                        <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                            {turn.speaker[0]}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900 mb-1">{turn.speaker}</div>
                            <div className="text-sm text-slate-700">{turn.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-sm flex flex-col items-center justify-center min-h-[420px]">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                    <MessageSquare className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">No dialogue audio generated yet</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    Choose a conversation scenario and select two distinct British voice personas on the left, then click generate.
                  </p>
                  <button
                    onClick={handleGenerateDialogue}
                    disabled={isGeneratingDialogue}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    Generate Sample Dialogue Now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "library" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Generated Audio Library</h2>
                <p className="text-xs text-slate-500">All reading passages and conversational dialogues created in this session</p>
              </div>
              <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg">
                {libraryItems.length} audio files
              </div>
            </div>

            {libraryItems.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-sm">
                <Library className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-800 mb-1">Your library is empty</h3>
                <p className="text-xs text-slate-500 mb-4">Generate reading articles or dialogues to see them stored here for quick replay and download.</p>
                <button
                  onClick={() => setActiveTab("reading")}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl"
                >
                  Go to Reading Studio
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {libraryItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                          item.type === "reading" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {item.type === "reading" ? "Reading Passage" : "Dialogue"}
                        </span>
                        <span className="text-xs text-slate-400">{item.createdAt}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {item.type === "reading" ? item.voiceLabel : `${item.speaker1} & ${item.speaker2}`}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <button
                        onClick={() => playAudio(item)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-sm"
                      >
                        {playingItemId === item.id && isPlaying ? (
                          <>
                            <Pause className="w-4 h-4" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4" /> Play Audio
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => downloadAudio(item)}
                        className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
                      >
                        <Download className="w-4 h-4" /> Download WAV
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500">
        BritSpeech Studio · Powered by Gemini 3.8 Flash TTS & Authentic British Voice Personas
      </footer>

      {/* API Key Gate Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-6 text-2xl font-bold shadow-inner">
              🔐
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-2">BritSpeech Studio</h2>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              Enter your personal Gemini API Key to use AI audio generation. Your key is stored securely and locally on your device.
            </p>

            <form onSubmit={handleSaveApiKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  autoFocus
                />
              </div>

              {keyError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{keyError}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      handleRemoveApiKey();
                    }}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-all cursor-pointer"
                  >
                    Remove Key
                  </button>
                )}
                <button
                  type="submit"
                  disabled={keyValidating}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer text-sm"
                >
                  {keyValidating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Validating Key...</span>
                    </>
                  ) : (
                    <span>Check & Start</span>
                  )}
                </button>
              </div>

              {!apiKey && (
                <p className="text-[11px] text-slate-400 text-center mt-3">
                  You can get a free API key from Google AI Studio.
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}
