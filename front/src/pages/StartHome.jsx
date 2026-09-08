import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CommonHeader from '../components/CommonHeader';

/**
 * 랜딩 — 스크롤을 내릴수록 이야기가 이어지는 세로 구성.
 * Hero(무엇) → About(왜) → Explore(무엇을) → How(어떻게) → CTA(시작)
 * 사진은 쓰지 않고 타이포·그라데이션·SVG로만 화면을 만듭니다.
 */

const TYPING_LINES = [
  '진짜 그 동네의 분위기를 담다.',
  'LocalVibe는 데이터 기반 추천으로\n분위기에 맞는 스팟을 빠르게 찾도록 도와줍니다.',
];

const VIBE_ROWS = [
  ['혼자 조용한 카페', '재즈 바', '노을 맛집', '힙한 골목', '로컬 술집', '야경 명소'],
  ['브런치 카페', '작은 갤러리', '감성 서점', '루프탑 바', '바다 근처 카페', '한적한 산책로'],
  ['디저트 맛집', '와인바', '라이브 공연', '사진 찍기 좋은 곳', '숨은 맛집', '레트로 감성'],
];

const STEPS = [
  {
    step: '01',
    title: '검색',
    desc: '가고 싶은 분위기나 지역을 자유롭게 입력하세요.\n"여수 감성 카페", "혼자 조용한 술집" 처럼요.',
  },
  {
    step: '02',
    title: '추천',
    desc: 'AI가 데이터 기반으로 숨은 로컬 스팟을 찾아드려요. 관광지 말고, 진짜 그 동네 장소로.',
  },
  {
    step: '03',
    title: '플래너에 담기',
    desc: '마음에 드는 장소를 여행 플래너에 담고 나만의 일정을 완성하세요.',
  },
];

const TECH_CARDS = [
  {
    icon: 'data',
    title: '한국관광공사 데이터',
    desc: '공공 관광 데이터 기반 지역 분석',
  },
  {
    icon: 'signal',
    title: '실시간 크롤링',
    desc: '네이버 블로그 기반 트렌드 반영',
  },
  {
    icon: 'spark',
    title: '맞춤 추천',
    desc: '분위기·관계유형에 맞춘 개인화',
  },
];

const TECH_ICON_PATHS = {
  data: 'M12 3.5c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6.5v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  signal: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8.4 15.6a5 5 0 0 1 0-7.2M15.6 8.4a5 5 0 0 1 0 7.2M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z',
};

function TechIcon({ name }) {
  return (
    <svg
      className="sh-tech-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={TECH_ICON_PATHS[name]} />
    </svg>
  );
}

/** 광주·전남을 추상화한 지도 그래픽 (실제 행정경계가 아닌 상징 도형). */
function MapGraphic() {
  return (
    <svg
      className="sh-map"
      viewBox="0 0 320 260"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 내륙 실루엣 */}
      <path d="M78 34c34-12 78-6 104 12s44 46 40 74c-4 26-26 44-52 52-30 9-64 12-92 0-26-11-42-36-42-64 0-30 12-62 42-74z" />
      {/* 남해안·섬 */}
      <path d="M96 196c14 10 34 16 56 14" strokeDasharray="4 6" />
      <circle cx="72" cy="214" r="7" />
      <circle cx="112" cy="230" r="4" />
      <circle cx="204" cy="206" r="5" />

      {/* 핀 — 순차 등장 */}
      <g className="sh-map-pin">
        <path d="M120 84c0 7-10 17-10 17s-10-10-10-17a10 10 0 0 1 20 0z" />
        <circle cx="110" cy="84" r="3" />
      </g>
      <g className="sh-map-pin">
        <path d="M186 108c0 7-10 17-10 17s-10-10-10-17a10 10 0 0 1 20 0z" />
        <circle cx="176" cy="108" r="3" />
      </g>
      <g className="sh-map-pin">
        <path d="M148 158c0 7-10 17-10 17s-10-10-10-17a10 10 0 0 1 20 0z" />
        <circle cx="138" cy="158" r="3" />
      </g>
      <g className="sh-map-pin">
        <path d="M232 66c0 7-10 17-10 17s-10-10-10-17a10 10 0 0 1 20 0z" />
        <circle cx="222" cy="66" r="3" />
      </g>
    </svg>
  );
}

function useTypingSequence(lines, { charDelay = 40, lineDelay = 400 } = {}) {
  const [lineIndex, setLineIndex] = useState(0);
  const [displayed, setDisplayed] = useState(['', '']);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (lineIndex >= lines.length) { setDone(true); return; }
    const full = lines[lineIndex];
    let i = 0;
    const tick = () => {
      i++;
      setDisplayed(prev => {
        const next = [...prev];
        next[lineIndex] = full.slice(0, i);
        return next;
      });
      if (i < full.length) {
        timer = setTimeout(tick, charDelay);
      } else {
        timer = setTimeout(() => setLineIndex(li => li + 1), lineDelay);
      }
    };
    let timer = setTimeout(tick, lineIndex === 0 ? 300 : lineDelay);
    return () => clearTimeout(timer);
  }, [lineIndex]);

  return { displayed, done, lineIndex };
}

function useFadeIn({ repeat = false } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('sh-visible');
          if (!repeat) observer.disconnect();
        } else if (repeat) {
          el.classList.remove('sh-visible');
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [repeat]);
  return ref;
}

export default function StartHome() {
  const navigate = useNavigate();
  const { displayed, done, lineIndex } = useTypingSequence(TYPING_LINES);
  const heroRef = useFadeIn();
  const aboutRef = useFadeIn({ repeat: true });
  const techRef = useFadeIn({ repeat: true });
  const vibeRef = useFadeIn({ repeat: true });
  const flowRef = useFadeIn({ repeat: true });
  const ctaRef = useFadeIn();

  return (
    <div className="sh-page">
      <CommonHeader />

      {/* ── 1. Hero ── */}
      <section className="sh-hero">
        <div ref={heroRef} className="sh-hero-inner sh-fade">
          <p className="sh-hero-eyebrow">AI 기반 로컬 여행 추천</p>
          <h1 className="sh-hero-title">
            {displayed[0]}
            {lineIndex === 0 && <span className="sh-cursor" />}
          </h1>
          <p className="sh-hero-desc">
            {displayed[1]}
            {lineIndex === 1 && <span className="sh-cursor" />}
          </p>
          <button
            type="button"
            className={`sh-hero-btn${done ? ' ready' : ''}`}
            onClick={() => navigate('/main')}
          >
            지금 시작하기 →
          </button>
        </div>
        <div className="sh-scroll-hint" aria-hidden="true">
          <span>SCROLL</span>
          <span className="sh-scroll-line" />
        </div>
      </section>

      {/* ── 2. About ── */}
      <section className="sh-section">
        <div ref={aboutRef} className="sh-about sh-fade">
          <div>
            <p className="sh-eyebrow">ABOUT</p>
            <p className="sh-about-lead">
              관광지 말고,
              <br />그 동네 사람들이 가는 곳으로.
            </p>
            <p className="sh-about-text">
              같은 도시라도 골목 하나를 사이에 두고 분위기는 완전히 달라집니다.
              유명한 곳만 훑고 돌아오는 여행이 아쉬웠던 이유죠.
            </p>
            <p className="sh-about-text">
              LocalVibe는 방문 데이터와 지역의 기록을 함께 읽어, 지금 그 동네가
              어떤 표정을 하고 있는지 찾아냅니다. 평점이 높은 곳이 아니라,
              당신이 찾던 분위기의 장소를 먼저 보여드립니다.
            </p>
          </div>
          <div className="sh-map-wrap">
            <MapGraphic />
          </div>
        </div>

        <div ref={techRef} className="sh-tech-grid sh-fade sh-stagger">
          {TECH_CARDS.map(card => (
            <div key={card.title} className="sh-tech-card">
              <TechIcon name={card.icon} />
              <h3 className="sh-tech-title">{card.title}</h3>
              <p className="sh-tech-desc">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. Explore ── */}
      <section ref={vibeRef} className="sh-section sh-fade">
        <p className="sh-eyebrow">EXPLORE</p>
        <h2 className="sh-section-title">어떤 분위기를 찾고 있나요?</h2>
        {VIBE_ROWS.map((row, i) => (
          <div key={i} className="sh-tag-row">
            {row.map(tag => (
              <button
                key={tag}
                type="button"
                className="sh-tag"
                onClick={() => navigate(`/main?query=${encodeURIComponent(tag)}`)}
              >
                {tag}
              </button>
            ))}
          </div>
        ))}
      </section>

      {/* ── 4. How to use ── */}
      <section ref={flowRef} className="sh-section sh-fade">
        <p className="sh-eyebrow">HOW TO USE</p>
        <h2 className="sh-section-title">세 단계면 충분해요</h2>
        <div className="sh-steps">
          {STEPS.map(item => (
            <div key={item.step} className="sh-step">
              <div className="sh-step-num">{item.step}</div>
              <h3 className="sh-step-title">{item.title}</h3>
              <p className="sh-step-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. CTA + 뉴스레터 ── */}
      <section ref={ctaRef} className="sh-cta sh-fade">
        <div className="sh-cta-inner">
          <h2 className="sh-cta-title">
            지금 바로 로컬 바이브를
            <br />
            경험해보세요
          </h2>
          <button
            type="button"
            className="sh-cta-btn"
            onClick={() => navigate('/main')}
          >
            전체 갤러리 보기 →
          </button>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className="sh-footer">
        <div className="sh-footer-inner">
          <div>
            <div className="sh-footer-brand">LocalVibe</div>
            <p className="sh-footer-desc">Discover real local stories with AI.</p>
          </div>
          <div className="sh-footer-links">
            {['Core Features', 'Pro Experience', 'Contact', 'Join'].map(l => (
              <span key={l} className="sh-footer-link">
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="sh-footer-bottom">
          © {new Date().getFullYear()} LocalVibe. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
