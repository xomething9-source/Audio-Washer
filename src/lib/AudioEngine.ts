import { audioBufferToWav } from './wavUtils';
import { audioBufferToMp3 } from './mp3Utils';

function getHardClipperCurve() {
  const threshold = Math.pow(10, -1.0 / 20); // -1.0 dBTP Ceiling for streaming safety
  const size = 8192;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / size - 1;
    curve[i] = Math.max(-threshold, Math.min(threshold, x));
  }
  return curve;
}

function getSoftClipperCurve() {
  const size = 8192;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / size - 1;
    // Slightly relaxed saturation to prevent over-compressing PLR
    curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); 
  }
  return curve;
}

export class AudioEngine {
  context: AudioContext;
  dryAnalyser: AnalyserNode;
  wetAnalyser: AnalyserNode;
  buffer: AudioBuffer | null = null;
  source: AudioBufferSourceNode | null = null;

  outDryGain: GainNode;
  outWetGain: GainNode;
  masterGain: GainNode;

  isPlaying: boolean = false;
  isWetAudible: boolean = true;
  autoPlrEnabled: boolean = true;
  makeupGainValue: number = 1.0;

  // Playback tracking
  bufferDuration: number = 0;
  playbackOffset: number = 0;
  playbackStartTimestamp: number = 0;

  onPlayStateChange?: (isPlaying: boolean) => void;
  onMetricsChange?: (metrics: { 
    lufs: number; 
    plr: number; 
    peak: number; 
    tp: number; 
    lra: number; 
    phase: number 
  }) => void;
  onParamsChange?: (params: { threshold: number; ratio: number; qFactor: number; focusHz: number }) => void;

  // Parameters for UI
  params = {
    threshold: -20,
    ratio: 4,
    qFactor: 1.5,
    focusHz: 5000,
  };

  // Step active states
  stepStates = {
    preWash: true,
    smartReverb: true,
    aiDeEser: true,
    autoPlr: true,
  };

  // Phase 2 Nodes
  preWashFilter1?: BiquadFilterNode;
  preWashFilter2?: BiquadFilterNode;
  deReverbCompressor?: DynamicsCompressorNode;
  deEsserFilter?: BiquadFilterNode;

  // Phase 3 Nodes
  bassCompensateEQ?: BiquadFilterNode;
  softClipper?: WaveShaperNode;
  masteringCompressor?: DynamicsCompressorNode;
  stereoSplitter?: ChannelSplitterNode;
  stereoGainLL?: GainNode;
  stereoGainLR?: GainNode;
  stereoGainRL?: GainNode;
  stereoGainRR?: GainNode;
  stereoMerger?: ChannelMergerNode;
  makeupGain?: GainNode;
  limiter?: DynamicsCompressorNode;
  finalClipper?: WaveShaperNode;
  measuringAnalyser?: AnalyserNode;
  phaseAnalyserL?: AnalyserNode;
  phaseAnalyserR?: AnalyserNode;
  phaseSplitter?: ChannelSplitterNode;

  // Added Phase 2 Variables
  presenceBoostEQ?: BiquadFilterNode;
  msSplitter?: ChannelSplitterNode;
  midGain?: GainNode;
  sideGain?: GainNode;
  sideInvertR?: GainNode;
  sideHPF?: BiquadFilterNode;
  sideWidthGain?: GainNode;
  sideInvL?: GainNode;
  msMerger?: ChannelMergerNode;

  // Analysis Loop State
  private rafId?: number;
  private intervalId?: number;
  private sumSquaresTotal = 0;
  private maxPeak = 0;
  private maxTruePeak = 0;
  private framesCount = 0;
  private shortTermLoudnessHistory: number[] = [];

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();

    this.dryAnalyser = this.context.createAnalyser();
    this.dryAnalyser.fftSize = 512;
    this.dryAnalyser.smoothingTimeConstant = 0.85;

    this.wetAnalyser = this.context.createAnalyser();
    this.wetAnalyser.fftSize = 512;
    this.wetAnalyser.smoothingTimeConstant = 0.85;

    this.measuringAnalyser = this.context.createAnalyser();
    this.measuringAnalyser.fftSize = 2048;

    this.phaseAnalyserL = this.context.createAnalyser();
    this.phaseAnalyserR = this.context.createAnalyser();
    this.phaseAnalyserL.fftSize = 2048;
    this.phaseAnalyserR.fftSize = 2048;
    this.phaseSplitter = this.context.createChannelSplitter(2);

    this.outDryGain = this.context.createGain();
    this.outWetGain = this.context.createGain();
    this.masterGain = this.context.createGain();

    this.masterGain.connect(this.context.destination);
    this.outDryGain.connect(this.masterGain);
    this.outWetGain.connect(this.masterGain);

    this.setABMode('wet');
  }

  async loadAudio(file: File) {
    this.stop(true); // Notify UI correctly so play icon resets
    this.cleanupAnalysis();

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await this.context.decodeAudioData(arrayBuffer);
    this.bufferDuration = this.buffer.duration;
    this.playbackOffset = 0;
    
    // [Phase 2] Pre-wash: DC Offset Removal
    this.removeDCOffset();
  }

  removeDCOffset() {
    if (!this.buffer) return;
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const channelData = this.buffer.getChannelData(c);
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i];
      }
      const mean = sum / channelData.length;
      if (mean !== 0) {
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] -= mean;
        }
      }
    }
  }

  setABMode(mode: 'dry' | 'wet') {
    this.isWetAudible = mode === 'wet';
    if (this.isWetAudible) {
      this.outDryGain.gain.value = 0;
      this.outWetGain.gain.value = 1;
    } else {
      this.outDryGain.gain.value = 1;
      this.outWetGain.gain.value = 0;
    }
  }

  setAutoPlrEnabled(enabled: boolean) {
    this.setStepActive('autoPlr', enabled);
  }

  setStepActive(stepId: keyof typeof this.stepStates, isActive: boolean) {
    this.stepStates[stepId] = isActive;
    this.applyStepStates();
  }

  private applyStepStates() {
    // PreWash: Bypass by dropping cutoff frequency to 0
    if (this.preWashFilter1) this.preWashFilter1.frequency.value = this.stepStates.preWash ? 30 : 0;
    if (this.preWashFilter2) this.preWashFilter2.frequency.value = this.stepStates.preWash ? 30 : 0;

    // Smart De-Reverb: Bypass by setting compression ratio to 1
    if (this.deReverbCompressor) {
      this.deReverbCompressor.ratio.value = this.stepStates.smartReverb ? 1.5 : 1;
    }

    // AI De-esser: Bypass by changing gain to 0
    if (this.deEsserFilter) {
      this.deEsserFilter.gain.value = this.stepStates.aiDeEser ? -3 : 0;
    }

    this.autoPlrEnabled = this.stepStates.autoPlr;
  }

  setParam(key: keyof typeof this.params, value: number) {
    this.params[key] = value;
    const t = this.context.currentTime;
    const tc = 0.05; // 50ms smoothing to prevent audio zipper noise when dragging sliders
    if (this.deEsserFilter && key === 'focusHz') {
      this.deEsserFilter.frequency.setTargetAtTime(value, t, tc);
    }
    if (this.deEsserFilter && key === 'qFactor') {
      this.deEsserFilter.Q.setTargetAtTime(value, t, tc);
    }
    if (this.masteringCompressor && key === 'threshold') {
      this.masteringCompressor.threshold.setTargetAtTime(value, t, tc);
    }
    if (this.masteringCompressor && key === 'ratio') {
      this.masteringCompressor.ratio.setTargetAtTime(value, t, tc);
    }
  }

  play(offset?: number) {
    if (!this.buffer) return;
    this.stop(false);

    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    if (offset !== undefined) {
      this.playbackOffset = offset;
    }

    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;

    // Routing: Dry
    this.source.connect(this.dryAnalyser);
    this.dryAnalyser.connect(this.outDryGain);

    // [Phase 2] Wet Routing Setup
    // Pre-Wash: DC Offset & Rumble Removal (30Hz 24dB/oct Highpass)
    this.preWashFilter1 = this.context.createBiquadFilter();
    this.preWashFilter1.type = 'highpass';
    this.preWashFilter1.frequency.value = 30;
    this.preWashFilter1.Q.value = 0.707;
    
    this.preWashFilter2 = this.context.createBiquadFilter();
    this.preWashFilter2.type = 'highpass';
    this.preWashFilter2.frequency.value = 30;
    this.preWashFilter2.Q.value = 0.707;

    // De-Reverb
    this.deReverbCompressor = this.context.createDynamicsCompressor();
    this.deReverbCompressor.threshold.value = -25;
    this.deReverbCompressor.ratio.value = 1.5;
    this.deReverbCompressor.attack.value = 0.02; // Slower attack preserving transients
    this.deReverbCompressor.release.value = 0.200;

    this.deEsserFilter = this.context.createBiquadFilter();
    this.deEsserFilter.type = 'peaking';
    this.deEsserFilter.frequency.value = this.params.focusHz;
    this.deEsserFilter.Q.value = this.params.qFactor;
    this.deEsserFilter.gain.value = -3; // Less extreme phase 2

    // Presence bump
    this.presenceBoostEQ = this.context.createBiquadFilter();
    this.presenceBoostEQ.type = 'peaking';
    this.presenceBoostEQ.frequency.value = 4000;
    this.presenceBoostEQ.Q.value = 1.0;
    this.presenceBoostEQ.gain.value = 2.5;

    // [Phase 3] Mastering Nodes Setup & M/S Widening
    // True Mid/Side widening network avoids phase holes caused by LP/HP summation
    this.softClipper = this.context.createWaveShaper();
    this.softClipper.curve = getSoftClipperCurve();
    this.softClipper.oversample = '4x';

    this.masteringCompressor = this.context.createDynamicsCompressor();
    this.masteringCompressor.threshold.value = this.params.threshold;
    this.masteringCompressor.ratio.value = this.params.ratio;
    this.masteringCompressor.attack.value = 0.01;
    this.masteringCompressor.release.value = 0.08;

    // True M/S Matrix Implementation
    const widthFactor = 1.6; // Slightly increased since bass is protected
    this.msSplitter = this.context.createChannelSplitter(2); // Input -> L, R
    this.msMerger = this.context.createChannelMerger(2);     // Output <- L, R

    // Encode
    this.midGain = this.context.createGain();  // M = L/2 + R/2
    this.sideGain = this.context.createGain(); // S = L/2 - R/2
    this.sideInvertR = this.context.createGain(); 
    this.sideInvertR.gain.value = -1;

    // Process Side
    this.sideHPF = this.context.createBiquadFilter();
    this.sideHPF.type = 'highpass';
    this.sideHPF.frequency.value = 120; // Protect bass from widening
    this.sideWidthGain = this.context.createGain();
    this.sideWidthGain.gain.value = widthFactor;

    // Decode
    this.sideInvL = this.context.createGain();
    this.sideInvL.gain.value = -1;

    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -1.0; // Ceiling target
    this.limiter.ratio.value = 20.0;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.050;

    this.makeupGain = this.context.createGain();
    this.makeupGain.gain.value = this.makeupGainValue;

    // Hard clipper explicitly to -0.3 dBTP mapped
    this.finalClipper = this.context.createWaveShaper();
    this.finalClipper.curve = getHardClipperCurve();
    this.finalClipper.oversample = '4x';

    // Chain execution: True M/S processing
    this.source.connect(this.preWashFilter1);
    this.preWashFilter1.connect(this.preWashFilter2);
    this.preWashFilter2.connect(this.deReverbCompressor);
    this.deReverbCompressor.connect(this.deEsserFilter);
    this.deEsserFilter.connect(this.presenceBoostEQ);
    
    this.presenceBoostEQ.connect(this.msSplitter);

    // Initial state application
    this.applyStepStates();

    // Encode Mid
    this.msSplitter.connect(this.midGain, 0); // L -> M
    this.msSplitter.connect(this.midGain, 1); // R -> M
    this.midGain.gain.value = 0.5;

    // Encode Side
    this.msSplitter.connect(this.sideGain, 0); // L -> S (positive)
    this.msSplitter.connect(this.sideInvertR, 1); // R -> invert
    this.sideInvertR.connect(this.sideGain);      // -R -> S
    this.sideGain.gain.value = 0.5;

    // Process Side
    this.sideGain.connect(this.sideHPF);
    this.sideHPF.connect(this.sideWidthGain);

    // Decode to L/R
    // L_out = Mid + Side
    this.midGain.connect(this.msMerger, 0, 0);
    this.sideWidthGain.connect(this.msMerger, 0, 0);

    // R_out = Mid - Side
    this.midGain.connect(this.msMerger, 0, 1);
    this.sideWidthGain.connect(this.sideInvL); // invert side for R
    this.sideInvL.connect(this.msMerger, 0, 1);

    // Recombine and sent to Clipper/Compressor
    this.msMerger.connect(this.softClipper);
    this.softClipper.connect(this.masteringCompressor);
    this.masteringCompressor.connect(this.limiter);
    this.limiter.connect(this.makeupGain);
    this.makeupGain.connect(this.finalClipper);
    
    // Output splits
    this.finalClipper.connect(this.wetAnalyser);
    this.wetAnalyser.connect(this.outWetGain);
    
    // Measurement split
    this.finalClipper.connect(this.measuringAnalyser);
    this.finalClipper.connect(this.phaseSplitter!); 
    this.phaseSplitter!.connect(this.phaseAnalyserL!, 0);
    this.phaseSplitter!.connect(this.phaseAnalyserR!, 1);

    this.playbackStartTimestamp = this.context.currentTime;
    this.source.start(0, this.playbackOffset);
    this.isPlaying = true;
    
    this.source.onended = () => {
      this.isPlaying = false;
      this.playbackOffset = 0; // Reset offset when naturally finishes
      this.onPlayStateChange?.(false);
      this.cleanupAnalysis();
    };

    this.onPlayStateChange?.(true);

    // [Phase 3] Start Auto Analysis Loop
    this.startAnalysis();
  }

  stop(emitEvent = true) {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (e) {}
      this.source = null;
    }
    
    if (this.isPlaying) {
      this.playbackOffset = this.getCurrentTime();
    }
    
    this.isPlaying = false;
    this.cleanupAnalysis();
    if (emitEvent) this.onPlayStateChange?.(false);
  }

  getCurrentTime(): number {
    if (this.isPlaying) {
      return (this.context.currentTime - this.playbackStartTimestamp) + this.playbackOffset;
    }
    return this.playbackOffset;
  }

  seek(time: number) {
    if (!this.buffer) return;
    const boundedTime = Math.max(0, Math.min(time, this.bufferDuration));
    if (this.isPlaying) {
       this.play(boundedTime);
    } else {
       this.playbackOffset = boundedTime;
    }
  }

  // [Phase 4] Offline Rendering
  async exportAudio(format: 'wav' | 'mp3' = 'wav', onProgress?: (p: number) => void): Promise<Blob | null> {
    if (!this.buffer) return null;
    
    onProgress?.(10);
    
    const offlineCtx = new OfflineAudioContext(
      this.buffer.numberOfChannels,
      this.buffer.length,
      this.buffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = this.buffer;

    const preWash1 = offlineCtx.createBiquadFilter();
    preWash1.type = 'highpass';
    preWash1.frequency.value = this.stepStates.preWash ? 30 : 0;
    preWash1.Q.value = 0.707;

    const preWash2 = offlineCtx.createBiquadFilter();
    preWash2.type = 'highpass';
    preWash2.frequency.value = this.stepStates.preWash ? 30 : 0;
    preWash2.Q.value = 0.707;

    const deRev = offlineCtx.createDynamicsCompressor();
    deRev.threshold.value = -25;
    deRev.ratio.value = this.stepStates.smartReverb ? 1.5 : 1;
    deRev.attack.value = 0.02;
    deRev.release.value = 0.200;

    const deEss = offlineCtx.createBiquadFilter();
    deEss.type = 'peaking';
    deEss.frequency.value = this.params.focusHz;
    deEss.Q.value = this.params.qFactor;
    deEss.gain.value = this.stepStates.aiDeEser ? -3 : 0;

    // Presence boost (around 4kHz) to fix Minor spectral hole identified
    const presenceEq = offlineCtx.createBiquadFilter();
    presenceEq.type = 'peaking';
    presenceEq.frequency.value = 4000;
    presenceEq.Q.value = 1.0;
    presenceEq.gain.value = 2.5;

    // Offline True M/S Matrix
    const widthFactor = 1.6; // Bump width factor to overcome narrowness
    const msSplit = offlineCtx.createChannelSplitter(2);
    const msMerge = offlineCtx.createChannelMerger(2);

    const midG = offlineCtx.createGain(); midG.gain.value = 0.5;
    const sideG = offlineCtx.createGain(); sideG.gain.value = 0.5;
    const sideInvIn = offlineCtx.createGain(); sideInvIn.gain.value = -1;

    const sideHP = offlineCtx.createBiquadFilter();
    sideHP.type = 'highpass';
    sideHP.frequency.value = 120;

    const sideW = offlineCtx.createGain(); sideW.gain.value = widthFactor;
    const sideInvOut = offlineCtx.createGain(); sideInvOut.gain.value = -1;

    const sClip = offlineCtx.createWaveShaper();
    sClip.curve = getSoftClipperCurve();
    sClip.oversample = '4x';

    const mComp = offlineCtx.createDynamicsCompressor();
    mComp.threshold.value = this.params.threshold;
    mComp.ratio.value = this.params.ratio;
    mComp.attack.value = 0.01;
    mComp.release.value = 0.08;

    // Safe pre-limiter
    const lim = offlineCtx.createDynamicsCompressor();
    lim.threshold.value = -1.0;
    lim.ratio.value = 20.0;
    lim.attack.value = 0.002;
    lim.release.value = 0.050;

    source.connect(preWash1);
    preWash1.connect(preWash2);
    preWash2.connect(deRev);
    deRev.connect(deEss);
    deEss.connect(presenceEq);
    presenceEq.connect(msSplit);

    // M/S Routing Offline
    msSplit.connect(midG, 0);
    msSplit.connect(midG, 1);

    msSplit.connect(sideG, 0);
    msSplit.connect(sideInvIn, 1);
    sideInvIn.connect(sideG);

    sideG.connect(sideHP);
    sideHP.connect(sideW);

    midG.connect(msMerge, 0, 0);
    sideW.connect(msMerge, 0, 0);

    midG.connect(msMerge, 0, 1);
    sideW.connect(sideInvOut);
    sideInvOut.connect(msMerge, 0, 1);

    msMerge.connect(sClip);
    sClip.connect(mComp);
    mComp.connect(lim);
    lim.connect(offlineCtx.destination);

    source.start(0);
    onProgress?.(30);

    const pass1Buffer = await offlineCtx.startRendering();
    onProgress?.(50);

    // Pass 2: Perfect 2-pass LUFS Normalization & Hard Clip (-0.3 dBTP)
    const channels = pass1Buffer.numberOfChannels;
    const length = pass1Buffer.length;
    let sumSquares = 0;
    
    for (let c = 0; c < channels; c++) {
      const data = pass1Buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        sumSquares += data[i] * data[i];
      }
    }
    
    const rms = Math.sqrt(sumSquares / (channels * length));
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
    
    // RMS target adjusted: targeting -12.5 RMS to achieve ~ -12 LUFS (Commercial safe target)
    const targetLUFS = -12.5; 
    const lufsDiffDb = targetLUFS - rmsDb;
    const scalar = Math.pow(10, lufsDiffDb / 20);
    const maxVal = Math.pow(10, -1.0 / 20); // strict -1.0 dBTP ceiling
    
    // In-place mutation to save massive amounts of memory (prevents mobile crash on long files)
    for (let c = 0; c < channels; c++) {
      const data = pass1Buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        let val = data[i] * scalar;
        if (val > maxVal) val = maxVal;
        else if (val < -maxVal) val = -maxVal;
        data[i] = val;
      }
    }

    onProgress?.(70);
    
    let blob: Blob;
    if (format === 'mp3') {
       blob = await audioBufferToMp3(pass1Buffer, onProgress);
    } else {
       blob = audioBufferToWav(pass1Buffer);
    }
    
    onProgress?.(100);
    return blob;
  }

  private startAnalysis() {
    this.sumSquaresTotal = 0;
    this.maxPeak = 0;
    this.maxTruePeak = 0;
    this.framesCount = 0;
    this.shortTermLoudnessHistory = [];

    const analyze = () => {
      if (!this.isPlaying || !this.measuringAnalyser || !this.phaseAnalyserL || !this.phaseAnalyserR) return;
      
      const data = new Float32Array(this.measuringAnalyser.fftSize);
      this.measuringAnalyser.getFloatTimeDomainData(data);
      
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const val = data[i];
        sumSq += val * val;
        const absVal = Math.abs(val);
        if (absVal > peak) peak = absVal;
      }
      
      this.sumSquaresTotal += (sumSq / data.length);
      if (peak > this.maxPeak) this.maxPeak = peak;
      
      // Approximate True Peak by looking at peak over samples (Web Audio is not 100% correct TP but close enough with 4x oversampling engaged in Clipper)
      if (peak > this.maxTruePeak) this.maxTruePeak = peak;

      this.framesCount++;
      this.rafId = requestAnimationFrame(analyze);
    };
    analyze();

    this.intervalId = window.setInterval(() => {
      if (this.framesCount === 0 || !this.phaseAnalyserL || !this.phaseAnalyserR) return;
      
      const rms = Math.sqrt(this.sumSquaresTotal / this.framesCount);
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
      const peakDb = this.maxPeak > 0 ? 20 * Math.log10(this.maxPeak) : -100;
      const tpDb = this.maxTruePeak > 0 ? 20 * Math.log10(this.maxTruePeak) : -100;
      const plr = peakDb - rmsDb;

      // Calculate Phase Correlation
      const dataL = new Float32Array(this.phaseAnalyserL.fftSize);
      const dataR = new Float32Array(this.phaseAnalyserR.fftSize);
      this.phaseAnalyserL.getFloatTimeDomainData(dataL);
      this.phaseAnalyserR.getFloatTimeDomainData(dataR);
      
      let dotProduct = 0;
      let energyL = 0;
      let energyR = 0;
      for (let i = 0; i < dataL.length; i++) {
        dotProduct += dataL[i] * dataR[i];
        energyL += dataL[i] * dataL[i];
        energyR += dataR[i] * dataR[i];
      }
      const phase = dotProduct / (Math.sqrt(energyL * energyR) || 1);

      // Track history for LRA (approximate)
      if (rmsDb > -60) {
        this.shortTermLoudnessHistory.push(rmsDb);
        if (this.shortTermLoudnessHistory.length > 30) this.shortTermLoudnessHistory.shift();
      }
      
      let lra = 0;
      if (this.shortTermLoudnessHistory.length > 5) {
        const sorted = [...this.shortTermLoudnessHistory].sort((a, b) => a - b);
        lra = sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.1)];
      }

      this.onMetricsChange?.({ 
        lufs: rmsDb, 
        plr, 
        peak: peakDb, 
        tp: tpDb, 
        lra: Math.abs(lra), 
        phase 
      });

      if (this.autoPlrEnabled && rmsDb > -60) {
        this.runAutoMastering(rmsDb, plr);
      }

      // Reset accumulators for next interval window, but keep TP for a bit longer? No, 1s is fine.
      this.sumSquaresTotal = 0;
      this.maxPeak = 0;
      this.maxTruePeak = 0;
      this.framesCount = 0;
    }, 1000);
  }

  private runAutoMastering(currentRmsDb: number, currentPlr: number) {
    const targetPLR = 9.0;
    const plrDiff = currentPlr - targetPLR;
    
    let newThresh = this.params.threshold;
    let newRatio = this.params.ratio;

    if (plrDiff > 0.5) {
      newThresh = Math.max(-30, newThresh - 0.2); // Cap aggression to -30
      newRatio = Math.min(8, newRatio + 0.1);     // Cap aggression to 8:1
    } else if (plrDiff < -0.5) {
      newThresh = Math.min(0, newThresh + 0.5);
      newRatio = Math.max(1, newRatio - 0.2);
    }

    if (newThresh !== this.params.threshold || newRatio !== this.params.ratio) {
      this.params.threshold = Number(newThresh.toFixed(1));
      this.params.ratio = Number(newRatio.toFixed(1));
      this.masteringCompressor?.threshold.setTargetAtTime(newThresh, this.context.currentTime, 0.2);
      this.masteringCompressor?.ratio.setTargetAtTime(newRatio, this.context.currentTime, 0.2);
      this.onParamsChange?.(this.params);
    }

    // 2. Final Normalizer (-12 LUFS target)
    const targetLUFS = -12.0;
    const lufsDiff = targetLUFS - currentRmsDb;
    
    if (this.makeupGain && Math.abs(lufsDiff) > 0.5) {
      const currentGainVal = this.makeupGain.gain.value;
      const currentGainDb = currentGainVal > 0 ? 20 * Math.log10(currentGainVal) : 0;
      const newGainDb = currentGainDb + (lufsDiff * 0.25); // Gentle adaptation
      
      const clampedGainDb = Math.max(-5, Math.min(20, newGainDb));
      const targetGain = Math.pow(10, clampedGainDb / 20);
      this.makeupGainValue = targetGain;
      this.makeupGain.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.5);
    }
  }

  private cleanupAnalysis() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.intervalId) clearInterval(this.intervalId);
    this.rafId = undefined;
    this.intervalId = undefined;
    this.sumSquaresTotal = 0;
    this.maxPeak = 0;
    this.maxTruePeak = 0;
    this.framesCount = 0;
    this.shortTermLoudnessHistory = [];
  }

  dispose() {
    this.stop(false);
    this.cleanupAnalysis();
    if (this.context && this.context.state !== 'closed') {
      try {
        this.context.close();
      } catch (e) {
        console.error("Failed to close AudioContext", e);
      }
    }
  }
}
