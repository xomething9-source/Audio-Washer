import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { motion } from 'motion/react';
import { Upload, Play, Square, Download, Settings2, Sparkles, Activity, FileAudio, SplitSquareHorizontal, Waves, Mic2, Ear, Loader2, Trash2, HelpCircle, X } from 'lucide-react';
import { AudioEngine } from './lib/AudioEngine';
import Visualizer from './components/Visualizer';

export default function App() {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<'normal' | 'expert'>('normal');
  const [abMode, setAbMode] = useState<'dry' | 'wet'>('wet');

  const [activeSteps, setActiveSteps] = useState({
    preWash: true,
    smartReverb: true,
    aiDeEser: true,
    autoPlr: true
  });

  const [params, setParams] = useState({
    threshold: -20,
    ratio: 4,
    qFactor: 1.5,
    focusHz: 5000,
  });

  const [metrics, setMetrics] = useState({ 
    lufs: -100, 
    plr: 0, 
    peak: -100, 
    tp: -100, 
    lra: 0, 
    phase: 1.0 
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [isDragging, setIsDragging] = useState(false);
  
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [originalFileName, setOriginalFileName] = useState('');
  const [exportCount, setExportCount] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [chainProgress, setChainProgress] = useState(4);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [tooltipConfig, setTooltipConfig] = useState<{text: string, x: number, y: number} | null>(null);

  const bindTooltip = (text: string | false | "") => {
    if (!text) return {};
    return {
      onMouseEnter: (e: React.MouseEvent) => setTooltipConfig({ text: text as string, x: e.clientX, y: e.clientY }),
      onMouseMove: (e: React.MouseEvent) => setTooltipConfig({ text: text as string, x: e.clientX, y: e.clientY }),
      onMouseLeave: () => setTooltipConfig(null),
    };
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const e = new AudioEngine();
    e.onPlayStateChange = (playing) => setIsPlaying(playing);
    e.onMetricsChange = (m) => setMetrics(m);
    e.onParamsChange = (p) => setParams(prev => ({ ...prev, ...p }));
    setEngine(e);
    return () => {
      e.dispose();
    };
  }, []);

  useEffect(() => {
    if (!engine) return;
    engine.setStepActive('preWash', activeSteps.preWash && chainProgress > 0);
    engine.setStepActive('smartReverb', activeSteps.smartReverb && chainProgress > 1);
    engine.setStepActive('aiDeEser', activeSteps.aiDeEser && chainProgress > 2);
    engine.setStepActive('autoPlr', activeSteps.autoPlr && chainProgress > 3);
  }, [activeSteps, chainProgress, engine]);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
       if (engine && !isScrubbing) setCurrentTime(engine.getCurrentTime());
       rafId = requestAnimationFrame(loop);
    };
    if (isPlaying) {
      rafId = requestAnimationFrame(loop);
    } else {
      if (engine && !isScrubbing) setCurrentTime(engine.getCurrentTime());
    }
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, engine, isScrubbing]);

  useEffect(() => {
    if (isLoaded) {
      setChainProgress(0);
      const t1 = setTimeout(() => setChainProgress(1), 1000);
      const t2 = setTimeout(() => setChainProgress(2), 2000);
      const t3 = setTimeout(() => setChainProgress(3), 3000);
      const t4 = setTimeout(() => setChainProgress(4), 4000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
    } else {
      setChainProgress(0);
    }
  }, [isLoaded, originalFileName]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoaded) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoaded]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoaded) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoaded]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isExporting) return;
    const file = e.target.files?.[0];
    if (!file || !engine) return;
    
    // Hard limit: Prevent crashing browser tab with massive files (150MB roughly 15 minutes of WAV)
    if (file.size > 150 * 1024 * 1024) {
      alert("파일 크기가 너무 큽니다 (제한: 150MB). 웹 브라우저의 메모리 한계로 인해 앱이 다운될 수 있습니다.");
      if (e.target) e.target.value = '';
      return;
    }
    
    setIsLoaded(false);
    setIsPlaying(false);
    engine.stop(true);

    setOriginalFileName(file.name);
    setExportCount(1);
    await engine.loadAudio(file);
    setDuration(engine.bufferDuration);
    setCurrentTime(0);
    setIsLoaded(true);
    
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isExporting) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isExporting) return;
    const file = e.dataTransfer.files?.[0];
    if (!file || !engine) return;
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|ogg|flac|m4a)$/i)) return;
    
    // Hard limit: Prevent crashing browser tab with massive files (150MB limit)
    if (file.size > 150 * 1024 * 1024) {
      alert("파일 크기가 너무 큽니다 (제한: 150MB). 웹 브라우저의 메모리 한계로 인해 앱이 다운될 수 있습니다.");
      return;
    }
    
    setIsLoaded(false);
    setIsPlaying(false);
    engine.stop(true);

    setOriginalFileName(file.name);
    setExportCount(1);
    await engine.loadAudio(file);
    setDuration(engine.bufferDuration);
    setCurrentTime(0);
    setIsLoaded(true);
  };

  const clearWorkspace = () => {
    if (isExporting) return;
    if (engine) engine.dispose();
    
    const e = new AudioEngine();
    e.onPlayStateChange = (playing) => setIsPlaying(playing);
    e.onMetricsChange = (m) => setMetrics(m);
    e.onParamsChange = (p) => setParams(prev => ({ ...prev, ...p }));
    setEngine(e);

    setIsLoaded(false);
    setOriginalFileName('');
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setMetrics({ lufs: -100, plr: 0, peak: -100 });
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const togglePlay = () => {
    if (!engine || !isLoaded || isExporting) return;
    if (isPlaying) {
      engine.stop();
    } else {
      engine.play();
    }
  };

  const setAbToggle = (newMode: 'dry' | 'wet') => {
    if (!engine || isExporting) return;
    setAbMode(newMode);
    engine.setABMode(newMode);
  };

  const handleParamChange = (k: keyof typeof params, v: number) => {
    if (isExporting) return;
    setParams(p => ({ ...p, [k]: v }));
    engine?.setParam(k, v);
  };

  const handleExport = async () => {
    if (!engine || !isLoaded || chainProgress < steps.length) return;
    setIsExporting(true);
    setExportProgress(0);
    try {
      const blob = await engine.exportAudio(exportFormat, (p) => setExportProgress(p));
      if (blob) {
        if (blob.size < 1024) {
           throw new Error('인코딩 오류 발생: 파일 크기가 비정상적으로 작습니다.');
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = originalFileName.replace(/\.[^/.]+$/, "") || "Stem_Washer_Result";
        const formattedCount = exportCount.toString().padStart(2, '0');
        a.download = `${baseName}_AWed_${formattedCount}.${exportFormat}`;
        a.click();
        
        alert("마스터링이 완료되었습니다! 파일 다운로드를 시작합니다.");

        // Add a small delay before revoking the URL to prevent download cancellation on Safari/mobile
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
        
        setExportCount(c => c + 1);
      }
    } catch (e) {
      console.error('Export failed:', e);
      alert(e instanceof Error ? e.message : 'Export failed due to encoding error.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const steps = [
    { id: 'preWash', label: 'Pre-Wash', icon: Waves, desc: 'DC Offset & Rumble', tooltip: 'DC Offset과 극저역의 불필요한 울림(로고 잡음 등)을 깨끗하게 정리합니다.' },
    { id: 'smartReverb', label: 'Smart De-reverb', icon: Mic2, desc: 'Tail suppression', tooltip: '사운드의 탁한 잔향과 지저분한 공간감을 스마트하게 억제합니다.' },
    { id: 'aiDeEser', label: 'AI De-esser', icon: Ear, desc: 'Dynamic sibilance control', tooltip: '귀를 찌르는 강한 치찰음(ㅅ, ㅊ, ㅍ 소리)을 부드럽게 제어합니다.' },
    { id: 'autoPlr', label: 'Auto PLR', icon: Activity, desc: 'Target 9.0 dB & 12 LUFS', tooltip: '상업 음원 타겟(LUFS -12, PLR 9)에 맞춰 최적의 볼륨과 펀치감을 자동으로 확보합니다.' },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-p)] font-sans h-screen w-full flex items-center justify-center p-6 overflow-hidden selection:bg-[var(--color-accent)]/30">
      <div className="grid grid-cols-4 grid-rows-[80px_1fr_1fr_minmax(100px,_auto)] gap-4 w-full h-full max-w-[1240px]">
        
        {/* Header (col-span-3) */}
        <div className="col-span-3 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between w-full h-full">
            <div className="flex items-center gap-2">
              <div className="flex items-baseline gap-2">
                <h1 className="text-[20px] font-semibold">Audio Washer</h1>
                <span className="text-[13px] font-medium text-[var(--color-text-s)] italic">by 그런거죠</span>
              </div>
              {isLoaded && (
                <button 
                  onClick={clearWorkspace}
                  disabled={isExporting}
                  className={`ml-3 flex items-center justify-center p-2.5 rounded-xl transition-all isolate group ${isExporting ? 'bg-[#FF3B30]/5 text-[#FF3B30]/50 cursor-not-allowed' : 'bg-[#FF3B30]/10 text-[#FF3B30] hover:bg-[#FF3B30]/20'}`}
                  {...bindTooltip("작업 초기화 (Clear Workspace)")}
                >
                  <Trash2 className={`w-8 h-8 ${isExporting ? '' : 'group-hover:scale-110'} transition-transform`} />
                </button>
              )}
            </div>
            
            <div className="flex items-center gap-4">
               <div className="text-[var(--color-text-s)] font-mono text-[12px]">REL_BUILD: 1.0.0-PROD</div>
               {/* Mode Switcher */}
               <div className={`flex bg-[#000] p-1 rounded-lg border border-[var(--color-border)] text-sm ${isExporting ? 'opacity-50 pointer-events-none' : ''}`}>
                 <button disabled={isExporting} onClick={() => setMode('normal')} className={`px-4 py-1.5 rounded-md font-medium transition-all ${mode === 'normal' ? 'bg-[var(--color-card-bg)] text-white shadow' : 'text-[var(--color-text-s)] hover:text-white'}`}>Normal</button>
                 <button disabled={isExporting} onClick={() => setMode('expert')} className={`px-4 py-1.5 rounded-md font-medium transition-all flex items-center gap-1.5 ${mode === 'expert' ? 'bg-[var(--color-card-bg)] text-white shadow' : 'text-[var(--color-text-s)] hover:text-white'}`}><Settings2 className="w-4 h-4"/> Expert</button>
               </div>
            </div>
          </div>
        </div>

        {/* Status Card (col-start-4) */}
        <div className="col-start-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl p-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(52,199,89,0.5)] ${isLoaded ? 'bg-[#34C759]' : 'bg-[#FF9F0A]'}`}></div>
            <span className="text-[13px] font-medium">{isLoaded ? 'System Ready' : 'Awaiting Input'}</span>
          </div>
          <button 
            onClick={() => setIsHelpOpen(true)}
            className="px-3 py-1.5 bg-[#ccff00] text-black font-black text-xs rounded-md hover:brightness-110 transition-all shadow-[0_0_12px_rgba(204,255,0,0.3)] tracking-tight"
          >
            사용법
          </button>
        </div>

        {/* Visualizer Main (col-span-3, row-span-2) */}
        <div className="col-span-3 row-span-2 bg-[#000] border border-[var(--color-border)] rounded-2xl relative overflow-hidden flex flex-col">
          <div className="absolute top-5 left-5 z-10 flex gap-5">
            <div>
              <div className="font-mono text-[10px] text-[var(--color-text-s)] mb-1 uppercase tracking-widest">Input Source</div>
              <div className="text-[14px] font-medium tracking-tight whitespace-nowrap">{isLoaded ? 'Internal Bus A-12' : 'No Signal'}</div>
            </div>
          </div>
          
          <div className="absolute top-5 right-5 z-10 flex flex-col items-end gap-2">
            <div className={`flex p-1 bg-[var(--color-card-bg)]/80 backdrop-blur rounded-lg border border-[var(--color-border)] text-xs ${isExporting ? 'opacity-50 pointer-events-none' : ''}`}>
              <button disabled={isExporting} onClick={() => setAbToggle('dry')} className={`px-3 py-1.5 rounded-md transition-all ${abMode === 'dry' ? 'bg-red-500/20 text-red-500' : 'text-[var(--color-text-s)] hover:text-white'}`}>Dry</button>
              <button disabled={isExporting} onClick={() => setAbToggle('wet')} className={`px-3 py-1.5 rounded-md transition-all ${abMode === 'wet' ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'text-[var(--color-text-s)] hover:text-white'}`}>Wet</button>
            </div>
            
            {isLoaded && isPlaying && (
              <div className="flex flex-col gap-1 items-end pr-1">
                <div className="flex gap-4">
                  <div className="text-[#34C759] font-mono text-[11px] font-bold tabular-nums drop-shadow-[0_0_8px_rgba(52,199,89,0.4)]">
                    LUFS {metrics.lufs.toFixed(1)}
                  </div>
                  <div className="text-[#34C759] font-mono text-[11px] font-bold tabular-nums drop-shadow-[0_0_8px_rgba(52,199,89,0.4)]">
                    PLR {metrics.plr.toFixed(1)}
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className={`font-mono text-[10px] font-bold tabular-nums ${metrics.tp > -1.0 ? 'text-amber-400' : 'text-[#34C759]/70'}`}>
                    TP {metrics.tp.toFixed(1)}
                  </div>
                  <div className="text-[#34C759]/70 font-mono text-[10px] font-bold tabular-nums">
                    LRA {metrics.lra.toFixed(1)}
                  </div>
                  <div className={`font-mono text-[10px] font-bold tabular-nums ${metrics.phase < 0.2 ? 'text-red-400' : 'text-[#34C759]/70'}`}>
                    PHASE {metrics.phase.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Typography Background */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-0 opacity-10 gap-3">
            <h2 className="text-center font-black tracking-tighter leading-[1.05] text-[2.5rem] bg-clip-text text-transparent bg-gradient-to-b from-white to-white/30">
              초보자를 위한 수노음원의<br/>70점 짜리 마스터링을 목표로 합니다.
            </h2>
            <p className="text-[12px] font-mono tracking-widest text-white/50 uppercase">
              Targeting 70/100 mastering quality for Suno audio beginners.
            </p>
          </div>

          <div className="flex-1 w-full h-full p-2 pt-14 flex items-end justify-center relative z-10 pointer-events-none">
            <Visualizer engine={engine} />
          </div>
        </div>

        {/* Params Card (col-start-4, row-span-2) */}
        <div className="col-start-4 row-span-2 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col gap-4 overflow-y-auto">
          <h2 className="text-[14px] font-medium mb-2">{mode === 'normal' ? 'Automated Chain' : 'Control Parameters'}</h2>
          
          {mode === 'normal' ? (
             <div className="flex flex-col gap-3 h-full">
                {steps.map((step, index) => {
                  const isUnlocked = chainProgress > index;
                  const isActive = isUnlocked && activeSteps[step.id as keyof typeof activeSteps];
                  return (
                    <button
                      key={step.id}
                      disabled={!isUnlocked || isExporting || (mode === 'normal' && index < 3)}
                      onClick={() => {
                        if (mode === 'normal' && index < 3) return; // Prevent toggle for first 3 in normal mode
                        setActiveSteps(s => ({ ...s, [step.id]: !isActive }))
                        engine?.setStepActive(step.id as "preWash" | "smartReverb" | "aiDeEser" | "autoPlr", !isActive);
                      }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${(mode === 'normal' && index < 3) ? '' : 'group'} ${
                        isActive ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/50' 
                        : isUnlocked ? 'bg-[#000] border-[var(--color-border)] opacity-70 hover:opacity-100'
                        : 'bg-[#000] border-[#333] opacity-30 cursor-not-allowed'
                      } ${(mode === 'normal' && index < 3) && isUnlocked ? 'cursor-default pointer-events-none' : 'cursor-pointer'} ${(isExporting && isUnlocked) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      {...bindTooltip((mode === 'normal' && index < 3) ? step.tooltip + " (상시 적용)" : step.tooltip)}
                    >
                      <step.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-s)]'}`} />
                      <div className="flex-1 min-w-0">
                         <div className={`text-xs font-bold leading-tight ${isActive ? 'text-white' : 'text-[var(--color-text-s)]'}`}>{step.label}</div>
                         <div className="text-[10px] text-[var(--color-text-s)] truncate">{step.desc}</div>
                      </div>
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`}></div>
                    </button>
                  )
                })}
             </div>
          ) : (
             <div className="flex flex-col gap-5 h-full">
                <div className="flex flex-col gap-1.5" {...bindTooltip("오디오 신호가 이 볼륨을 넘을 때부터 압축(제어)이 시작되는 기준점입니다.")}>
                  <div className="flex justify-between items-end">
                    <label className="text-[11px] font-semibold text-[var(--color-text-s)] uppercase tracking-wider flex items-center gap-1">Threshold {activeSteps.autoPlr && isPlaying && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse"></span>}</label>
                    <span className="text-[12px] font-mono text-[var(--color-text-s)]">{params.threshold.toFixed(1)} dB</span>
                  </div>
                  <input type="range" min="-60" max="0" value={params.threshold} onChange={e => handleParamChange('threshold', parseFloat(e.target.value))} disabled={isExporting} className="w-full accent-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
                <div className="flex flex-col gap-1.5" {...bindTooltip("임계점을 넘은 소리를 얼마나 강하게 누를지(압축할지) 결정하는 비율입니다.")}>
                  <div className="flex justify-between items-end">
                    <label className="text-[11px] font-semibold text-[var(--color-text-s)] uppercase tracking-wider flex items-center gap-1">Ratio {activeSteps.autoPlr && isPlaying && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse"></span>}</label>
                    <span className="text-[12px] font-mono text-[var(--color-text-s)]">{params.ratio.toFixed(1)}:1</span>
                  </div>
                  <input type="range" min="1" max="20" step="0.1" value={params.ratio} onChange={e => handleParamChange('ratio', parseFloat(e.target.value))} disabled={isExporting} className="w-full accent-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
                <div className="flex flex-col gap-1.5" {...bindTooltip("보컬의 선명도나 악기의 존재감을 살리기 위해 집중적으로 강조할 목표 주파수입니다.")}>
                  <div className="flex justify-between items-end">
                    <label className="text-[11px] font-semibold text-[var(--color-text-s)] uppercase tracking-wider">Target Freq</label>
                    <span className="text-[12px] font-mono text-[var(--color-text-s)]">{params.focusHz} Hz</span>
                  </div>
                  <input type="range" min="20" max="20000" step="10" value={params.focusHz} onChange={e => handleParamChange('focusHz', parseFloat(e.target.value))} disabled={isExporting} className="w-full accent-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
                <div className="flex flex-col gap-1.5" {...bindTooltip("이퀄라이저가 적용되는 주파수의 폭(넓이)을 결정합니다. 값이 클수록 뾰족하게 제어됩니다.")}>
                  <div className="flex justify-between items-end">
                    <label className="text-[11px] font-semibold text-[var(--color-text-s)] uppercase tracking-wider">Q Factor</label>
                    <span className="text-[12px] font-mono text-[var(--color-text-s)]">{params.qFactor.toFixed(1)}</span>
                  </div>
                  <input type="range" min="0.1" max="10" step="0.1" value={params.qFactor} onChange={e => handleParamChange('qFactor', parseFloat(e.target.value))} disabled={isExporting} className="w-full accent-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed" />
                </div>
             </div>
          )}
        </div>

        {/* Transport & File UI (col-span-4) */}
        <div className="col-span-4 bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl flex items-center justify-between px-8 py-5 relative overflow-hidden">
           {isExporting && (
             <div className="absolute inset-0 bg-[var(--color-bg)]/80 backdrop-blur-sm z-10 flex items-center justify-center gap-3">
               <Loader2 className="w-5 h-5 text-[var(--color-accent)] animate-spin" />
               <span className="font-mono text-sm tracking-widest text-[var(--color-accent)]">RENDERING [{exportProgress}%]</span>
             </div>
           )}

           {/* Load Area */}
           <div 
             className="w-[180px]"
             onDragOver={handleDragOver}
             onDragLeave={handleDragLeave}
             onDrop={handleDrop}
           >
             <input type="file" accept="audio/*" ref={fileInputRef} className="hidden" onChange={handleFileUpload} disabled={isExporting} />
             <button onClick={() => fileInputRef.current?.click()} disabled={isExporting} className={`w-full h-[52px] flex items-center justify-center gap-2 border border-dashed rounded-xl transition-all text-sm ${isDragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] scale-[1.02]' : 'border-[var(--color-border)] text-[var(--color-text-s)] hover:bg-white/5'} ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
               <Upload className="w-4 h-4" /> {isDragging ? 'Drop Audio' : (isLoaded ? 'Change Source' : 'Load Audio')}
             </button>
           </div>
           
           {/* Center Transport Area */}
           <div className="flex-1 flex items-center gap-8 pl-12 pr-6">
             <button disabled={!isLoaded || isExporting} onClick={togglePlay} className={`w-[52px] h-[52px] shrink-0 rounded-full flex items-center justify-center transition-colors ${!isLoaded || isExporting ? 'bg-white/10 text-white/30 cursor-not-allowed' : 'bg-white text-black hover:bg-zinc-200 cursor-pointer'}`}>
               {isPlaying ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
             </button>
             
             <div className="flex flex-col shrink-0 w-[80px]">
               <div className="font-mono text-[16px] font-semibold tracking-wider">{isPlaying ? 'PLAYING' : 'IDLE'}</div>
               <div className="text-[10px] text-[var(--color-text-s)] tracking-widest uppercase">Playback</div>
             </div>
             
             {/* Interactive Timeline */}
             <div className="flex-1 h-[44px] bg-[var(--color-card-bg)] rounded-lg flex flex-col justify-center px-3 border border-white/10 shadow-inner group py-1">
               <div className="flex justify-between text-[10px] text-[var(--color-text-s)] font-mono mb-1.5">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
               </div>
               <div className="relative flex items-center h-4 group">
                 <input 
                     type="range" 
                     min="0" 
                     max={duration || 100} 
                     step="0.01" 
                     value={currentTime} 
                     disabled={!isLoaded || isExporting}
                     onPointerDown={() => setIsScrubbing(true)}
                     onPointerUp={(e) => {
                       setIsScrubbing(false);
                       engine?.seek(parseFloat(e.currentTarget.value));
                     }}
                     onChange={(e) => {
                       setCurrentTime(parseFloat(e.target.value));
                     }}
                     className={`w-full relative z-10 appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed outline-none
                     [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-[var(--color-border)] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:transition-colors
                     group-hover:[&::-webkit-slider-runnable-track]:bg-white/30
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform
                     group-active:[&::-webkit-slider-thumb]:scale-150`}
                 />
                 {/* Progress Fill Indicator */}
                 <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-[var(--color-accent)] rounded-full pointer-events-none" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}></div>
               </div>
             </div>
           </div>

           {/* Export Action */}
           <div className="w-[140px] shrink-0 flex flex-col gap-1.5">
             <div className={`flex bg-[#000] p-1 rounded-lg border border-[var(--color-border)] text-[10px] font-medium h-[26px] ${isExporting ? 'opacity-50 pointer-events-none' : ''}`}>
                <button disabled={isExporting} onClick={() => setExportFormat('wav')} className={`flex-1 rounded-md transition-all ${exportFormat === 'wav' ? 'bg-[var(--color-card-bg)] text-white' : 'text-[var(--color-text-s)] hover:text-white'}`}>WAV</button>
                <button disabled={isExporting} onClick={() => setExportFormat('mp3')} className={`flex-1 rounded-md transition-all ${exportFormat === 'mp3' ? 'bg-[var(--color-card-bg)] text-white' : 'text-[var(--color-text-s)] hover:text-white'}`}>MP3</button>
             </div>
             <button disabled={!isLoaded || isExporting || chainProgress < steps.length} onClick={handleExport} className={`w-full h-[40px] flex items-center justify-center gap-2 rounded-xl border transition-all text-sm ${!isLoaded || isExporting || chainProgress < steps.length ? 'bg-[#000] border-[var(--color-border)] text-[var(--color-text-s)] opacity-50 cursor-not-allowed' : 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white hover:brightness-110 shadow-lg shadow-[var(--color-accent)]/20 cursor-pointer'}`} {...bindTooltip(chainProgress < steps.length && isLoaded ? "체인 구성을 기다려주세요" : false)}>
               <Download className="w-4 h-4" /> Export
             </button>
           </div>
        </div>

      </div>

      {/* Help Modal */}
      {isHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-[var(--color-border)] flex justify-between items-center bg-[#000]/50">
              <h2 className="text-lg font-bold flex items-center gap-2"><HelpCircle className="w-5 h-5 text-[var(--color-accent)]"/> Audio Washer 사용 방법</h2>
              <button onClick={() => setIsHelpOpen(false)} className="text-[var(--color-text-s)] hover:text-white transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh] text-sm text-[var(--color-text-p)] leading-relaxed space-y-4">
              
              <div className="bg-[#2e66ff]/10 border border-[#2e66ff]/30 p-4 rounded-xl mb-2">
                <p className="font-bold text-white mb-1.5 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#7096ff]"/> 초보자를 위한 자동 마스터링
                </p>
                <p className="text-xs text-[var(--color-text-s)] leading-relaxed">
                  복잡한 조작은 필요 없습니다! 오토 체인의 <strong className="text-white bg-[#000] px-1 rounded">처음 3개 단계는 온/오프 상태와 무관하게 시스템 내부에서 상시 동작</strong>하여 안전한 퀄리티를 유지합니다. 사용자는 <strong className="text-[#7096ff]">마지막 Auto PLR 버튼만 취향에 맞춰 조작</strong>하시면 됩니다.
                </p>
              </div>

              <p>
                <strong>Suno AI</strong>와 같은 인공지능 생성 음원은 종종 탁한 울림이나 공간감이 과도한 경우가 많습니다. 
                Audio Washer는 이 음원들을 70점 이상의 실용 품질로 즉시 정돈해 줍니다.
              </p>
              
              <ul className="space-y-3 list-disc pl-5 marker:text-[var(--color-accent)]">
                <li><strong className="text-white">Pre-Wash:</strong> 들리지 않는 불필요한 초저역대(잡음)와 중앙선(DC Offset)의 찌그러짐을 상시 제거합니다.</li>
                <li><strong className="text-white">Smart De-reverb:</strong> 탁하고 지저분한 인공 잔향을 억제해 소리를 선명하게 잡아줍니다.</li>
                <li><strong className="text-white">AI De-esser:</strong> 치찰음(ㅅ, ㅊ)이 귀를 찌르지 않도록 동적으로 깎아냅니다.</li>
                <li><strong className="text-white">Auto PLR (선택):</strong> 타겟 음압(LUFS -12)에 맞춰 힘 있게 볼륨 펌핑을 수행합니다.</li>
              </ul>

              <div className="bg-[#2b2518] border border-[#ffb340]/50 p-4 rounded-xl mt-6">
                <h3 className="font-bold text-[#ffb340] mb-2 flex items-center gap-2">
                  <span>⚠️</span> 사고 방지를 위한 시스템 주의사항
                </h3>
                <ul className="space-y-2 text-xs text-[#e5e5e5] list-disc pl-5 marker:text-[#ffb340]/70 leading-relaxed">
                  <li>
                    <strong className="text-white">모바일 메모리 폭발 (OOM):</strong> 웹 오디오 한계상 5분이 넘어가는 고용량 48kHz WAV 파일을 아이폰(Safari) 등 메모리가 제한적인 환경에 올릴 경우 탭이 터지거나 멈출 수 있습니다.
                  </li>
                  <li>
                    <strong className="text-white">꿀렁거림 (Pumping) 현상:</strong> 조용한 도입부에서 극강의 코러스로 터지는 다이내믹 구간에서 Auto PLR 알고리즘이 급격히 작동하며 소리가 출렁일 수 있습니다.
                  </li>
                  <li>
                    <strong className="text-white">타격감 찌그러짐 (Distortion):</strong> 강한 드럼 소스(킥/스네어)가 뭉개지거나 피크 한계로 플라스틱 튀는 소리가 날 수 있습니다. 너무 심하다면 우측 상단 <strong>[Expert]</strong> 모드에서 Threshold를 조금씩 내려주세요.
                  </li>
                </ul>
              </div>

              <div className="bg-[#000] border border-[var(--color-border)] p-4 rounded-xl text-xs mt-2">
                <strong>전문가 팁:</strong> 우측 상단의 <code className="bg-[var(--color-card-bg)] px-1 py-0.5 rounded text-[var(--color-accent)]">Expert</code> 모드로 전환하면 압축의 강도와 강조할 주파수를 직접 미세조정 할 수 있습니다. 
              </div>
            </div>
            <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
              <button onClick={() => setIsHelpOpen(false)} className="px-6 py-2 bg-[var(--color-accent)] text-white font-medium rounded-lg hover:brightness-110 transition-all">
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Floating Tooltip */}
      {tooltipConfig && (
        <div 
          className="fixed z-[9999] bg-[#1a1a1a]/95 border border-white/10 text-white text-[12px] p-2.5 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] pointer-events-none max-w-[220px] leading-relaxed backdrop-blur-md"
          style={{ 
            left: Math.min(tooltipConfig.x + 15, typeof window !== 'undefined' ? window.innerWidth - 240 : 0), 
            top: Math.min(tooltipConfig.y + 15, typeof window !== 'undefined' ? window.innerHeight - 80 : 0)
          }}
        >
          {tooltipConfig.text}
        </div>
      )}
    </div>
  );
}
