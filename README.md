🫧 Audio Washer v1.0

Audio Washer는 인공지능(AI) 생성 음원 및 가이드 레코딩의 지저분한 요소를 제거하고, 상업적 스트리밍 표준에 맞게 자동으로 마스터링해주는 100% 브라우저 기반 오디오 프로세싱 툴입니다.
특히 Suno AI와 같은 서비스로 생성된 음원 특유의 과도한 잔향과 탁한 중저역대를 정돈하여, 즉시 배포 가능한 수준(70점 이상의 품질)으로 끌어올리는 데 최적화되어 있습니다.


✨ 주요 기능 (Key Features)

1. 4단계 자동화 마스터링 체인 (Auto Chain)
Pre-Wash: 들리지 않는 불필요한 초저역대 럼블과 DC Offset을 제거하여 헤드룸을 확보합니다.
Smart De-reverb: 생성형 AI 음원의 고질적인 문제인 지저분한 인공 잔향을 억제하여 소리를 선명하게 만듭니다.
AI De-esser: 귀를 찌르는 치찰음(ㅅ, ㅊ 등)을 실시간 분석하여 부동적으로 제어합니다.
Auto PLR (Dynamics Control): 상업 음원 타겟(LUFS -14~-10, PLR 9.0)에 맞춰 자동으로 펀치감과 볼륨을 확보합니다.

2. 전문가 모드 (Expert Mode)
자동화 뒤에 숨겨진 파라미터(Threshold, Ratio, Target Frequency, Q Factor)를 직접 미세 조정할 수 있습니다.

3. 실시간 시각화 (Real-time Visualizer)
Dry(원본)와 Wet(처리본) 신호의 스펙트럼 차이를 실시간으로 비교하며 모니터링할 수 있습니다.

4. 고음질 내보내기 (Export)
WAV (16-bit PCM) 및 MP3 (320kbps) 포맷 지원.
오프라인 렌더링 방식을 통해 브라우저 성능에 구애받지 않는 고품질 마스터링 결과를 생성합니다.

🔒 개인정보 보호 및 보안 (Privacy First)
보안을 위해 오디오 데이터를 그 어디에도 전송하지 않습니다.
모든 음향 분석 및 처리는 사용자의 브라우저 내부(Web Audio API)에서 로컬 자원만 사용하여 수행됩니다.
사용자의 소중한 창작물은 외부 서버로 유출되지 않으며, 인터넷 연결 없이도 초기 로딩 후 모든 기능을 사용할 수 있습니다.

🛠 기술 스택 (Tech Stack)
Frontend: React 19, TypeScript, Tailwind CSS, Framer Motion
Audio Engine: Web Audio API (AudioContext, OfflineAudioContext)
Icons: Lucide React
Encoding Library: Lamejs (MP3), Custom WAV Encoder

🚀 시작하기 (Getting Started)
빌드 및 실행
code
Bash
npm install
npm run dev

사용 방법
Load Audio 버튼을 클릭하거나 파일을 드래그하여 불러옵니다.
Play를 눌러 실시간으로 변화하는 사운드를 확인합니다.
Dry/Wet 스위치로 마스터링 전후를 비교합니다.
결과가 만족스러우면 WAV 또는 MP3를 선택하고 Export를 클릭합니다.

⚠️ 주의사항
브라우저 메모리 한계로 인해 약 150MB(WAV 기준 약 15분) 이상의 대용량 파일은 처리가 제한될 수 있습니다.
최적의 성능과 경험을 위해 Chrome 또는 Edge 브라우저 사용을 권장합니다.
