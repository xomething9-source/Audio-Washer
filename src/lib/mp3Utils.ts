// Workaround for Vite strict mode module missing definitions in lamejs
if (typeof window !== 'undefined') {
  (window as any).MPEGMode = (window as any).MPEGMode || {};
  (window as any).Lame = (window as any).Lame || {};
  
  // Quantize.js uses BitStream globally without importing it
  (window as any).BitStream = (window as any).BitStream || {};
  (window as any).BitStream.EQ = (window as any).BitStream.EQ || function (a: number, b: number) {
    return (Math.abs(a) > Math.abs(b)) 
      ? (Math.abs(a - b) <= Math.abs(a) * 1e-6)
      : (Math.abs(a - b) <= Math.abs(b) * 1e-6);
  };
  (window as any).BitStream.NEQ = (window as any).BitStream.NEQ || function (a: number, b: number) {
    return !(window as any).BitStream.EQ(a, b);
  };

  (window as any).VbrMode = (window as any).VbrMode || {};
  (window as any).Float = (window as any).Float || {};
  (window as any).ShortBlock = (window as any).ShortBlock || {};
  (window as any).CalcNoiseData = (window as any).CalcNoiseData || {};
  (window as any).CalcNoiseResult = (window as any).CalcNoiseResult || {};
}

export async function audioBufferToMp3(
  buffer: AudioBuffer,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  // Dynamically load lamejs from CDN to avoid Vite strict mode bundling corruption
  await new Promise<void>((resolve, reject) => {
    if ((window as any).lamejs) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.0/lame.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load lamejs from CDN'));
    document.head.appendChild(script);
  });

  const lamejs = (window as any).lamejs;
  
  // Force Stereo (2 channels) for MP3 encoding to prevent Mono + 320kbps crash
  const channels = 2;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 320);
  const mp3Data: Int8Array[] = [];

  const sampleBlockSize = 1152;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const length = left.length;

  const leftInt16 = new Int16Array(sampleBlockSize);
  const rightInt16 = new Int16Array(sampleBlockSize);

  for (let i = 0; i < length; i += sampleBlockSize) {
    const chunkLen = Math.min(sampleBlockSize, length - i);

    for (let j = 0; j < chunkLen; j++) {
      let l = left[i + j];
      if (l > 1) l = 1; else if (l < -1) l = -1;
      leftInt16[j] = l < 0 ? l * 32768 : l * 32767;
      
      let r = right[i + j];
      if (r > 1) r = 1; else if (r < -1) r = -1;
      rightInt16[j] = r < 0 ? r * 32768 : r * 32767;
    }

    const leftChunk = leftInt16.subarray(0, chunkLen);
    const rightChunk = rightInt16.subarray(0, chunkLen);
    
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));

    // Yield to main thread every ~100 iterations (approx 2.6 seconds of audio at 44.1kHz)
    // Helps maintain smooth UI updates for progress bar
    if (i % (sampleBlockSize * 100) === 0) {
      if (onProgress) {
        // Map 70% to 90% range for encoding phase
        const progress = 70 + (i / length) * 20; 
        onProgress(progress);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const flushBuf = mp3encoder.flush();
  if (flushBuf.length > 0) mp3Data.push(new Int8Array(flushBuf));

  if (onProgress) onProgress(95);

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
