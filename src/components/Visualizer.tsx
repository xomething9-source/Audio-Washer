import { useEffect, useRef } from 'react';
import { AudioEngine } from '../lib/AudioEngine';

export default function Visualizer({ engine }: { engine: AudioEngine | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const bufferLength = engine.dryAnalyser.frequencyBinCount;
    const dryDataArray = new Uint8Array(bufferLength);
    const wetDataArray = new Uint8Array(bufferLength);
    
    // Allocate smoothing arrays (large enough for high-res screens)
    const smoothedDry = new Float32Array(512);
    const smoothedWet = new Float32Array(512);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      if (engine.isPlaying) {
        engine.dryAnalyser.getByteFrequencyData(dryDataArray);
        engine.wetAnalyser.getByteFrequencyData(wetDataArray);
      } else {
        dryDataArray.fill(0);
        wetDataArray.fill(0);
      }

      const padding = 20;
      const drawableWidth = width - padding * 2;
      const drawableHeight = height - padding;
      
      const gap = 4;
      const barWidth = 12;
      const numBars = Math.floor(drawableWidth / (barWidth + gap));
      const step = Math.floor((bufferLength - 10) / numBars); // Reserve headroom
      
      // OPTIMIZATION: Create gradient ONCE for the whole canvas height
      const masterWetGradient = ctx.createLinearGradient(0, height, 0, 0);
      masterWetGradient.addColorStop(0, '#2E66FF'); 
      masterWetGradient.addColorStop(1, '#7096FF'); 

      let x = padding;

      // Start path batching for dry and wet
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      for (let i = 0; i < numBars; i++) {
        const dataIndex = 2 + (i * step);
        const targetDry = (dryDataArray[dataIndex] || 0) / 255;
        smoothedDry[i] += (targetDry - smoothedDry[i]) * 0.15;
        const dryHeight = smoothedDry[i] * drawableHeight * 0.9;
        
        if (dryHeight > 0.5) {
          ctx.roundRect(x + (i * (barWidth + gap)), height - dryHeight, barWidth, dryHeight, [4, 4, 0, 0]);
        }
      }
      ctx.fill();

      ctx.fillStyle = masterWetGradient;
      ctx.beginPath();
      for (let i = 0; i < numBars; i++) {
        const dataIndex = 2 + (i * step);
        const targetWet = (wetDataArray[dataIndex] || 0) / 255;
        smoothedWet[i] += (targetWet - smoothedWet[i]) * 0.15;
        const wetHeight = smoothedWet[i] * drawableHeight * 0.9;
        
        if (wetHeight > 0.5) {
          ctx.roundRect(x + (i * (barWidth + gap)), height - wetHeight, barWidth, wetHeight, [4, 4, 0, 0]);
        }
      }
      ctx.fill();
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [engine]);

  return (
    <canvas
      ref={canvasRef}
      width={1024}
      height={300}
      className="w-full h-full bg-transparent"
    />
  );
}
