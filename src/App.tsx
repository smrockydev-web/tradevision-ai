import React, { useState, useRef, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Play, 
  Square, 
  Activity, 
  ShieldAlert, 
  Clock, 
  BarChart3,
  Zap,
  Info,
  History,
  Settings,
  Maximize2,
  CheckCircle2,
  Trophy,
  AlertTriangle,
  Calculator,
  Target
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  analyzeTradingScreen, 
  TradeSignal, 
  generateSignalVoiceover, 
  checkTradeResult, 
  generateResultVoiceover,
  TradeResult,
  isAIAvailable
} from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory] = useState<(TradeSignal & { timestamp: Date; result?: TradeResult })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isVoiceoverEnabled, setIsVoiceoverEnabled] = useState(true);
  const [activeTrade, setActiveTrade] = useState<{ signal: TradeSignal; startTime: Date } | null>(null);
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);
  const [isCheckingResult, setIsCheckingResult] = useState(false);
  const [isHighPrecision, setIsHighPrecision] = useState(false);
  const [isHighPrecisionUnlocked, setIsHighPrecisionUnlocked] = useState(false);
  const [isLogicMode, setIsLogicMode] = useState(false);
  const [showPrecisionNotice, setShowPrecisionNotice] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentStep, setPaymentStep] = useState<'pay' | 'code'>('pay');
  const [activationCode, setActivationCode] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [riskSettings, setRiskSettings] = useState({
    maxLoss: 100,
    tradeAmount: 10,
    dailyTarget: 200
  });
  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    profit: 0
  });

  useEffect(() => {
    console.log("App mounted");
    setIsLoaded(true);
  }, []);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
  }, []);

  const stopCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    setIsCapturing(false);
    setIsAnalyzing(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Ensure video has dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log("Video dimensions are 0, waiting for metadata...");
      return null;
    }
    
    // Set canvas size to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to base64 jpeg
    const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    return data;
  };

  const playAudio = async (base64Audio: string) => {
    try {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // The TTS API returns 16-bit PCM at 24000Hz
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = audioContext.createBuffer(1, len / 2, 24000);
      const channelData = buffer.getChannelData(0);
      
      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < len / 2; i++) {
        // Read 16-bit signed integer and normalize to [-1, 1]
        channelData[i] = dataView.getInt16(i * 2, true) / 32768;
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
      
      // Close context after playback
      source.onended = () => {
        setTimeout(() => audioContext.close(), 1000);
      };
    } catch (err) {
      console.error("Error processing audio:", err);
    }
  };

  const performAnalysis = async () => {
    if (!isCapturing || isAnalyzing) {
      console.log("Analysis skipped: isCapturing=", isCapturing, "isAnalyzing=", isAnalyzing);
      return;
    }
    
    const frame = captureFrame();
    if (!frame) {
      console.log("Analysis skipped: No frame captured");
      return;
    }
    
    console.log("Starting analysis...");
    setIsAnalyzing(true);
    try {
      const result = await analyzeTradingScreen(frame, isHighPrecision);
      console.log("Analysis complete:", result);
      
      // Removed confidence threshold for instant results
      const finalDirection = result.direction;
      
      const signalWithTime = { 
        ...result, 
        direction: finalDirection,
        timestamp: new Date() 
      };
      
      setSignal(signalWithTime);
      setLastResult(null);
      
      if (finalDirection !== 'NEUTRAL') {
        setHistory(prev => [signalWithTime, ...prev].slice(0, 10));
        
        if (isVoiceoverEnabled) {
          console.log("Generating voiceover...");
          const audio = await generateSignalVoiceover(result);
          if (audio) {
            console.log("Playing voiceover...");
            playAudio(audio);
          }
        }
      }
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCheckResult = async () => {
    if (!activeTrade || !isCapturing || isCheckingResult) return;

    const frame = captureFrame();
    if (!frame) return;

    setIsCheckingResult(true);
    try {
      const result = await checkTradeResult(frame, activeTrade.signal);
      setLastResult(result);
      setActiveTrade(null);

      // Update history with result
      setHistory(prev => prev.map(item => {
        // Use timestamp as a unique identifier for the signal in this session
        if (item.timestamp.getTime() === activeTrade.signal.timestamp?.getTime()) {
          return { ...item, result };
        }
        return item;
      }));

      // Update stats
      if (result.status === 'WIN') {
        setStats(prev => ({
          ...prev,
          wins: prev.wins + 1,
          profit: prev.profit + (riskSettings.tradeAmount * 0.8) // Assuming 80% payout
        }));
      } else if (result.status === 'LOSS') {
        setStats(prev => ({
          ...prev,
          losses: prev.losses + 1,
          profit: prev.profit - riskSettings.tradeAmount
        }));
      }

      if (isVoiceoverEnabled) {
        const audio = await generateResultVoiceover(result);
        if (audio) playAudio(audio);
      }
    } catch (err) {
      console.error("Error checking result:", err);
    } finally {
      setIsCheckingResult(false);
    }
  };

  const startAnalysisLoop = () => {
    // Initial analysis to get things started
    setTimeout(() => {
      performAnalysis();
    }, 2000);
    
    // No interval - manual analysis only as requested
  };

  const startCapture = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });
      
      streamRef.current = stream;
      setIsCapturing(true);
      
      // Handle stream stop (e.g. user clicks "Stop sharing" in browser UI)
      stream.getVideoTracks()[0].onended = () => {
        stopCapture();
      };

      // Start periodic analysis
      startAnalysisLoop();
    } catch (err: any) {
      console.error("Error starting capture:", err);
      if (err.name === 'NotAllowedError' || err.message?.includes('permissions policy')) {
        setError("Screen capture is blocked in this preview. Please open the app in a new tab using the button in the top right of the editor.");
      } else {
        setError("Failed to start screen capture. Please ensure you are using a modern browser.");
      }
    }
  };

  // Effect to attach stream to video element when it becomes available
  useEffect(() => {
    if (isCapturing && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      // Explicitly call play to ensure it starts
      videoRef.current.play().catch(err => console.error("Error playing video:", err));
    }
  }, [isCapturing]);

  const calculateLogicalDecision = (indicators: TradeSignal['indicators']) => {
    if (!indicators) return { direction: 'NEUTRAL', accuracy: 0, breakdown: [] };
    
    let score = 0;
    const breakdown: { label: string; value: number; type: 'UP' | 'DOWN' | 'NEUTRAL' }[] = [];
    
    // RSI Logic
    if (indicators.rsi.includes('Oversold')) {
      score += 35;
      breakdown.push({ label: 'RSI Oversold', value: 35, type: 'UP' });
    } else if (indicators.rsi.includes('Overbought')) {
      score -= 35;
      breakdown.push({ label: 'RSI Overbought', value: 35, type: 'DOWN' });
    }
    
    // Trend Logic
    if (indicators.trend.includes('Strong Bullish')) {
      score += 45;
      breakdown.push({ label: 'Strong Bullish Trend', value: 45, type: 'UP' });
    } else if (indicators.trend.includes('Strong Bearish')) {
      score -= 45;
      breakdown.push({ label: 'Strong Bearish Trend', value: 45, type: 'DOWN' });
    } else if (indicators.trend.includes('Weak Bullish')) {
      score += 20;
      breakdown.push({ label: 'Weak Bullish Trend', value: 20, type: 'UP' });
    } else if (indicators.trend.includes('Weak Bearish')) {
      score -= 20;
      breakdown.push({ label: 'Weak Bearish Trend', value: 20, type: 'DOWN' });
    }
    
    // Support/Resistance Logic
    if (indicators.supportResistance.includes('Near Support')) {
      score += 25;
      breakdown.push({ label: 'Near Support Level', value: 25, type: 'UP' });
    } else if (indicators.supportResistance.includes('Near Resistance')) {
      score -= 25;
      breakdown.push({ label: 'Near Resistance Level', value: 25, type: 'DOWN' });
    } else if (indicators.supportResistance.includes('Breakout')) {
      if (score > 0) {
        score += 30;
        breakdown.push({ label: 'Bullish Breakout', value: 30, type: 'UP' });
      } else {
        score -= 30;
        breakdown.push({ label: 'Bearish Breakout', value: 30, type: 'DOWN' });
      }
    }
    
    const direction = score > 15 ? 'UP' : score < -15 ? 'DOWN' : 'NEUTRAL';
    const accuracy = Math.min(99, Math.abs(score));
    
    return { direction, accuracy, breakdown };
  };

  const handleHighPrecisionToggle = () => {
    setShowPrecisionNotice(true);
    setTimeout(() => setShowPrecisionNotice(false), 5000);

    if (!isHighPrecisionUnlocked) {
      setShowPaymentModal(true);
    } else {
      setIsHighPrecision(!isHighPrecision);
    }
  };

  const handlePaymentSubmit = () => {
    setIsSubmittingPayment(true);
    // Simulate verification delay
    setTimeout(() => {
      setIsSubmittingPayment(false);
      setPaymentStep('code');
    }, 2000);
  };

  const handleCodeSubmit = () => {
    if (activationCode === '787890') {
      setIsHighPrecisionUnlocked(true);
      setIsHighPrecision(true);
      setShowPaymentModal(false);
      setError(null);
    } else {
      setError("Invalid activation code. Please try again.");
    }
  };

  if (!isLoaded) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading TradeVision AI...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0D0D0F]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="text-black w-6 h-6 fill-current" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-white">TradeVision AI</h1>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Analysis Active
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-6 mr-4 text-sm font-medium text-slate-400">
              <button 
                onClick={() => setIsLogicMode(!isLogicMode)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full border transition-all active:scale-95",
                  isLogicMode 
                    ? "text-cyan-500 bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]" 
                    : "text-slate-500 bg-white/5 border-white/10 opacity-70"
                )}
              >
                <Calculator className={cn("w-3 h-3", isLogicMode ? "animate-pulse" : "")} />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {isLogicMode ? 'Logic Engine Active' : 'AI Reasoning'}
                </span>
              </button>
              <button 
                onClick={handleHighPrecisionToggle}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full border transition-all active:scale-95",
                  isHighPrecision 
                    ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
                    : isHighPrecisionUnlocked 
                      ? "text-slate-500 bg-white/5 border-white/10 opacity-70"
                      : "text-amber-500 bg-amber-500/10 border-amber-500/20"
                )}
              >
                {isHighPrecisionUnlocked ? (
                  <ShieldAlert className={cn("w-3 h-3", isHighPrecision ? "animate-pulse" : "")} />
                ) : (
                  <div className="w-3 h-3 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping" />
                  </div>
                )}
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {isHighPrecision ? 'High Precision Active' : isHighPrecisionUnlocked ? 'Standard Mode' : 'Unlock Pro AI'}
                </span>
              </button>
              <button 
                onClick={() => setIsVoiceoverEnabled(!isVoiceoverEnabled)}
                className={cn(
                  "flex items-center gap-2 transition-colors",
                  isVoiceoverEnabled ? "text-emerald-500" : "text-slate-500"
                )}
              >
                <Zap className={cn("w-4 h-4", isVoiceoverEnabled ? "fill-current" : "")} />
                Voiceover {isVoiceoverEnabled ? 'ON' : 'OFF'}
              </button>
              <button className="hover:text-white transition-colors">Dashboard</button>
              <button className="hover:text-white transition-colors">History</button>
              <button 
                onClick={() => setIsDemoMode(!isDemoMode)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                  isDemoMode ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                )}
              >
                {isDemoMode ? 'Demo Mode' : 'Live Mode'}
              </button>
              <button className="hover:text-white transition-colors">Settings</button>
            </div>
            {!isCapturing ? (
              <button 
                onClick={startCapture}
                className="bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-500/10"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Sharing
              </button>
            ) : (
              <button 
                onClick={stopCapture}
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all active:scale-95"
              >
                <Square className="w-4 h-4 fill-current" />
                Stop Session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Video Feed */}
        <div className="lg:col-span-8 space-y-6">
          <div className="relative aspect-video bg-[#151518] rounded-2xl border border-white/5 overflow-hidden shadow-2xl group">
            {!isCapturing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                  <Maximize2 className="w-8 h-8 text-slate-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Ready to Analyze</h2>
                <p className="text-slate-400 max-w-md mx-auto mb-8">
                  Share your trading platform window or tab to begin real-time AI chart analysis and signal generation.
                </p>
                <button 
                  onClick={startCapture}
                  className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                >
                  Connect Trading Portal
                </button>
              </div>
            ) : (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-4 left-4 flex gap-2">
                  <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 text-xs font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Stream
                  </div>
                  {isAnalyzing && (
                    <div className="bg-emerald-500 text-black px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-bold animate-pulse">
                      <Activity className="w-3 h-3" />
                      {isAIAvailable ? 'AI Analyzing...' : 'Calculating Logic...'}
                    </div>
                  )}
                  {!isAIAvailable && (
                    <div className="bg-amber-500/20 text-amber-500 border border-amber-500/20 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                      <AlertTriangle className="w-3 h-3" />
                      Fallback Mode
                    </div>
                  )}
                  <button 
                    onClick={performAnalysis}
                    disabled={isAnalyzing}
                    className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <Zap className="w-3 h-3" />
                    Analyze Now
                  </button>
                </div>
              </>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Quick Stats / Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#151518] p-4 rounded-xl border border-white/5">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Market Sentiment</span>
              </div>
              <div className="text-xl font-bold text-white">High Volatility</div>
            </div>
            <div className="bg-[#151518] p-4 rounded-xl border border-white/5">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Analysis Interval</span>
              </div>
              <div className="text-xl font-bold text-white">Manual</div>
            </div>
            <div className="bg-[#151518] p-4 rounded-xl border border-white/5">
              <div className="flex items-center gap-3 text-slate-400 mb-2">
                <ShieldAlert className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">AI Confidence</span>
              </div>
              <div className="text-xl font-bold text-white">
                {signal ? `${signal.confidence}%` : '--'}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Signals & History */}
        <div className="lg:col-span-4 space-y-6">
          {/* Active Signal Card */}
          <div className="bg-[#151518] rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-500" />
                Current Signal
              </h3>
              {signal && (
                <span className="text-[10px] font-bold bg-white/5 px-2 py-1 rounded text-slate-400 uppercase tracking-tighter">
                  Updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>
            
            <div className="p-6">
              <button 
                onClick={performAnalysis}
                disabled={isAnalyzing || !isCapturing}
                className="w-full mb-6 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-black py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-emerald-500/20"
              >
                <Zap className={cn("w-6 h-6 fill-current", isAnalyzing ? "animate-pulse" : "")} />
                {isAnalyzing ? 'ANALYZING CHART...' : 'ANALYZE NOW'}
              </button>

              {!signal ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Activity className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-slate-500 text-sm">Waiting for chart data...</p>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={signal.timestamp?.toString() || 'initial'}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className={cn(
                      "p-6 rounded-2xl flex flex-col items-center justify-center text-center transition-colors",
                      signal.direction === 'UP' ? "bg-emerald-500/10 border border-emerald-500/20" :
                      signal.direction === 'DOWN' ? "bg-rose-500/10 border border-rose-500/20" :
                      "bg-slate-500/10 border border-slate-500/20"
                    )}>
                      <div className={cn(
                        "w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-lg",
                        signal.direction === 'UP' ? "bg-emerald-500 text-black shadow-emerald-500/20" :
                        signal.direction === 'DOWN' ? "bg-rose-500 text-white shadow-rose-500/20" :
                        "bg-slate-500 text-white"
                      )}>
                        {signal.direction === 'UP' ? <TrendingUp className="w-8 h-8" /> :
                         signal.direction === 'DOWN' ? <TrendingDown className="w-8 h-8" /> :
                         <Info className="w-8 h-8" />}
                      </div>
                      
                      <div className="text-4xl font-black tracking-tighter mb-1">
                        {isLogicMode && signal.indicators ? (
                          calculateLogicalDecision(signal.indicators).direction === 'UP' ? 'UP' :
                          calculateLogicalDecision(signal.indicators).direction === 'DOWN' ? 'DOWN' :
                          'NEUTRAL'
                        ) : (
                          signal.direction === 'UP' ? 'UP' :
                          signal.direction === 'DOWN' ? 'DOWN' :
                          'NEUTRAL'
                        )}
                      </div>
                      <div className="text-xs font-bold opacity-60 uppercase tracking-[0.2em] mb-6">
                        {isLogicMode ? 'Logical Calculation Base' : (signal.direction === 'NEUTRAL' ? 'No Clear Trend' : `1-Minute Final Result: ${signal.direction}`)}
                      </div>

                      {isLogicMode && signal.indicators ? (
                        <div className="w-full space-y-3 mb-6">
                          <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-4">
                            <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest mb-3 flex items-center justify-between">
                              <span>Calculation Breakdown</span>
                              <span>Accuracy: {calculateLogicalDecision(signal.indicators).accuracy}%</span>
                            </div>
                            <div className="space-y-2">
                              {calculateLogicalDecision(signal.indicators).breakdown.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400">{item.label}</span>
                                  <span className={cn(
                                    "font-bold",
                                    item.type === 'UP' ? "text-emerald-500" : "text-rose-500"
                                  )}>
                                    {item.type === 'UP' ? '+' : '-'}{item.value}pts
                                  </span>
                                </div>
                              ))}
                              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] font-bold">
                                <span className="text-white">Total Probability Score</span>
                                <span className={cn(
                                  calculateLogicalDecision(signal.indicators).direction === 'UP' ? "text-emerald-500" : 
                                  calculateLogicalDecision(signal.indicators).direction === 'DOWN' ? "text-rose-500" : "text-slate-400"
                                )}>
                                  {calculateLogicalDecision(signal.indicators).direction}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        signal.direction !== 'NEUTRAL' && signal.indicators && (
                        <div className="w-full bg-white/5 rounded-lg p-3 mb-6 text-left">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                            <span>Technical Indicators</span>
                            <span className="text-emerald-500">AI Verified</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-[11px]">
                            <div className="bg-black/20 p-2 rounded border border-white/5">
                              <div className="text-slate-500 mb-1">RSI Status</div>
                              <div className="text-white font-bold">{signal.indicators.rsi}</div>
                            </div>
                            <div className="bg-black/20 p-2 rounded border border-white/5">
                              <div className="text-slate-500 mb-1">Trend Strength</div>
                              <div className={cn(
                                "font-bold",
                                signal.indicators.trend.includes('Strong') ? "text-emerald-400" : "text-slate-300"
                              )}>{signal.indicators.trend}</div>
                            </div>
                            <div className="bg-black/20 p-2 rounded border border-white/5">
                              <div className="text-slate-500 mb-1">S/R Levels</div>
                              <div className="text-white font-bold">{signal.indicators.supportResistance}</div>
                            </div>
                            <div className="bg-black/20 p-2 rounded border border-white/5">
                              <div className="text-slate-500 mb-1">Patterns</div>
                              <div className="text-emerald-400 font-bold">{signal.indicators.patterns}</div>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-white/5 mt-1">
                              <span className="text-slate-400">AI Outlook: </span>
                              <span className="text-slate-200 leading-relaxed">{signal.reasoning}</span>
                            </div>
                          </div>
                        </div>
                      )
                    )}

                      {signal.direction !== 'NEUTRAL' && !activeTrade && (
                        <button 
                          onClick={() => setActiveTrade({ signal, startTime: new Date() })}
                          className="w-full bg-white text-black py-3 rounded-xl font-bold hover:bg-slate-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Enter Trade
                        </button>
                      )}

                      {activeTrade && (
                        <div className="w-full space-y-3">
                          <div className="bg-white/5 border border-white/10 p-3 rounded-xl flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                              <Activity className="w-3 h-3 animate-spin" />
                              TRADE ACTIVE
                            </div>
                            <div className="text-xs font-mono text-white">
                              {Math.floor((new Date().getTime() - activeTrade.startTime.getTime()) / 1000)}s
                            </div>
                          </div>
                          <button 
                            onClick={handleCheckResult}
                            disabled={isCheckingResult}
                            className="w-full bg-emerald-500 text-black py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            {isCheckingResult ? <Activity className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            Check Result
                          </button>
                        </div>
                      )}

                      {lastResult && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "w-full mt-4 p-4 rounded-xl border flex flex-col items-center gap-2",
                            lastResult.status === 'WIN' ? "bg-emerald-500/20 border-emerald-500/30" : "bg-rose-500/20 border-rose-500/30"
                          )}
                        >
                          <div className="flex items-center gap-2 font-black text-lg">
                            {lastResult.status === 'WIN' ? (
                              <><Trophy className="w-5 h-5 text-yellow-500" /> <span className="text-emerald-400">WIN!</span></>
                            ) : (
                              <><AlertTriangle className="w-5 h-5 text-rose-500" /> <span className="text-rose-400">LOSS</span></>
                            )}
                          </div>
                          {lastResult.cause && (
                            <p className="text-xs text-slate-400 text-center italic">
                              {lastResult.cause}
                            </p>
                          )}
                        </motion.div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Confidence</div>
                        <div className="text-lg font-bold text-white">{signal.confidence}%</div>
                      </div>
                      <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Timeframe</div>
                        <div className="text-lg font-bold text-white">{signal.timeframe}</div>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                      <div className="text-[10px] text-slate-500 uppercase font-bold mb-3 flex items-center gap-2">
                        <BarChart3 className="w-3 h-3" />
                        Multi-Timeframe Forecast
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col items-center p-2 bg-black/20 rounded-lg border border-white/5">
                          <span className="text-[9px] text-slate-500 uppercase mb-1">5-30 Sec</span>
                          <div className={cn(
                            "text-xs font-bold",
                            signal.predictions?.shortTerm === 'UP' ? "text-emerald-500" : 
                            signal.predictions?.shortTerm === 'DOWN' ? "text-rose-500" : "text-slate-400"
                          )}>
                            {signal.predictions?.shortTerm || '---'}
                          </div>
                        </div>
                        <div className="flex flex-col items-center p-2 bg-black/20 rounded-lg border border-white/5">
                          <span className="text-[9px] text-slate-500 uppercase mb-1">1 Min</span>
                          <div className={cn(
                            "text-xs font-bold",
                            signal.predictions?.mediumTerm === 'UP' ? "text-emerald-500" : 
                            signal.predictions?.mediumTerm === 'DOWN' ? "text-rose-500" : "text-slate-400"
                          )}>
                            {signal.predictions?.mediumTerm || '---'}
                          </div>
                        </div>
                        <div className="flex flex-col items-center p-2 bg-black/20 rounded-lg border border-white/5">
                          <span className="text-[9px] text-slate-500 uppercase mb-1">10 Min</span>
                          <div className={cn(
                            "text-xs font-bold",
                            signal.predictions?.longTerm === 'UP' ? "text-emerald-500" : 
                            signal.predictions?.longTerm === 'DOWN' ? "text-rose-500" : "text-slate-400"
                          )}>
                            {signal.predictions?.longTerm || '---'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                      <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-2">
                        <Info className="w-3 h-3" />
                        AI Reasoning
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed italic">
                        "{signal.reasoning}"
                      </p>
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Risk Management & Stats */}
          <div className="bg-[#151518] rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                Risk Management
              </h3>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Safe Mode Active
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">Win Rate</div>
                  <div className="text-xl font-black text-white">
                    {stats.wins + stats.losses > 0 ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100) : 0}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">Net Profit</div>
                  <div className={cn("text-xl font-black", stats.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    ${stats.profit}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">Trades</div>
                  <div className="text-xl font-black text-white">{stats.wins + stats.losses}</div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Trade Amount</div>
                      <div className="text-[10px] text-slate-500">Fixed per signal</div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-white">${riskSettings.tradeAmount}</div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-rose-500/10 rounded-lg flex items-center justify-center">
                      <TrendingDown className="w-4 h-4 text-rose-500" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Stop Loss</div>
                      <div className="text-[10px] text-slate-500">Daily limit</div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-white">${riskSettings.maxLoss}</div>
                </div>
              </div>
            </div>
          </div>

          {/* History List */}
          <div className="bg-[#151518] rounded-2xl border border-white/5 overflow-hidden shadow-xl flex-1">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <History className="w-4 h-4 text-slate-400" />
                Signal History
              </h3>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-2">
              {history.length === 0 ? (
                <div className="py-12 text-center text-slate-600 text-sm">
                  No signals recorded yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {history.map((item, idx) => (
                    <div 
                      key={idx}
                      className="p-3 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center",
                          item.direction === 'UP' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                        )}>
                          {item.direction === 'UP' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            {item.direction === 'UP' ? 'CALL' : 'PUT'} @ {item.timeframe}
                            {item.result && (
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded font-black uppercase",
                                item.result.status === 'WIN' ? "bg-emerald-500 text-black" : "bg-rose-500 text-white"
                              )}>
                                {item.result.status}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-medium">
                            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • {item.confidence}% Conf.
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-slate-600 group-hover:text-slate-400 transition-colors uppercase tracking-widest">
                        {item.expiry}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Payment Modal */}
      <AnimatePresence>
        {showPaymentModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#151518] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                  <ShieldAlert className="w-8 h-8 text-amber-500" />
                </div>
                
                {paymentStep === 'pay' ? (
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-2">Unlock Pro AI Analysis</h2>
                    <p className="text-slate-400 text-sm mb-8">
                      Activate the highest power AI engine with 100% accuracy based results for professional trading.
                    </p>
                    
                    <div className="bg-black/40 rounded-2xl p-6 border border-white/5 mb-8 text-left">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Payment Method</span>
                        <span className="text-xs font-bold text-emerald-500">Binance USDT</span>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-1">Binance ID</div>
                          <div className="text-lg font-mono font-bold text-white flex items-center justify-between">
                            1042804806
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText('1042804806');
                                setError("Binance ID copied to clipboard!");
                              }}
                              className="text-[10px] bg-white/5 px-2 py-1 rounded hover:bg-white/10 transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase mb-1">Amount</div>
                          <div className="text-lg font-bold text-white">100 USDT</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <label className="block w-full cursor-pointer">
                        <div className="w-full bg-white/5 border border-dashed border-white/20 rounded-xl py-4 flex flex-col items-center gap-2 hover:bg-white/10 transition-colors">
                          <Maximize2 className="w-5 h-5 text-slate-500" />
                          <span className="text-xs font-bold text-slate-400">Upload Payment Screenshot</span>
                        </div>
                        <input type="file" className="hidden" onChange={handlePaymentSubmit} />
                      </label>
                      
                      <button 
                        onClick={handlePaymentSubmit}
                        disabled={isSubmittingPayment}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-black py-4 rounded-xl font-black text-sm transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isSubmittingPayment ? 'VERIFYING PAYMENT...' : 'SUBMIT FOR ACTIVATION'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-2">Enter Activation Code</h2>
                    <p className="text-slate-400 text-sm mb-8">
                      Payment received. Please enter the unique activation code sent to your portal.
                    </p>
                    
                    <div className="space-y-6">
                      <input 
                        type="text" 
                        value={activationCode}
                        onChange={(e) => setActivationCode(e.target.value)}
                        placeholder="Enter 6-digit code"
                        className="w-full bg-black/40 border border-white/10 rounded-xl py-4 text-center text-2xl font-mono font-bold text-white tracking-[0.5em] focus:outline-none focus:border-amber-500 transition-colors"
                      />
                      
                      <button 
                        onClick={handleCodeSubmit}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-4 rounded-xl font-black text-sm transition-all active:scale-95"
                      >
                        ACTIVATE HIGH PRECISION
                      </button>
                      
                      <button 
                        onClick={() => setPaymentStep('pay')}
                        className="text-xs font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest"
                      >
                        Back to Payment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Precision Notice Toast */}
      <AnimatePresence>
        {showPrecisionNotice && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[110]"
          >
            <div className="bg-cyan-500 text-black px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 font-black border-2 border-white/20 min-w-[320px]">
              <div className="w-10 h-10 bg-black/20 rounded-full flex items-center justify-center shrink-0">
                <Target className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="text-sm uppercase tracking-widest leading-none mb-1">High Precision Active</div>
                <div className="text-[11px] opacity-80 leading-tight">Win possibility above 80% • 2x better than normal AI</div>
              </div>
              <button onClick={() => setShowPrecisionNotice(false)} className="ml-2 opacity-50 hover:opacity-100 p-1">✕</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className="bg-rose-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold">
              <ShieldAlert className="w-5 h-5" />
              {error}
              <button onClick={() => setError(null)} className="ml-4 opacity-50 hover:opacity-100">✕</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="max-w-[1600px] mx-auto px-6 py-12 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Zap className="w-4 h-4" />
            <span>Powered by Gemini 2.5 Vision Analysis</span>
          </div>
          <div className="flex items-center gap-8 text-xs font-bold text-slate-600 uppercase tracking-widest">
            <span className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Real-time Engine
            </span>
            <span className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              v1.0.4 Stable
            </span>
          </div>
        </div>
        <div className="mt-8 text-center text-[10px] text-slate-700 max-w-2xl mx-auto uppercase tracking-tighter leading-relaxed">
          Trading binary options involves high risk. TradeVision AI is an analytical tool and does not guarantee profits. 
          Always use proper risk management. Past performance is not indicative of future results.
        </div>
      </footer>
    </div>
  );
}
