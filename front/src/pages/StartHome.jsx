import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StartNavbar from '../components/StartNavbar';

function useFadeIn() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('sh-visible');
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

export default function StartHome() {
  const navigate = useNavigate();
  const heroRef = useFadeIn();
  const vibeRef = useFadeIn();
  const techRef = useFadeIn();
  const feedRef = useFadeIn();
  const ctaRef = useFadeIn();

  const vibeRows = [
    [
      '혼자 조용한 카페',
      '재즈 바',
      '노을 맛집',
      '힙한 골목',
      '로컬 술집',
      '야경 명소',
    ],
    [
      '브런치 카페',
      '작은 갤러리',
      '감성 서점',
      '루프탑 바',
      '바다 근처 카페',
      '한적한 산책로',
    ],
    [
      '디저트 맛집',
      '와인바',
      '라이브 공연',
      '사진 찍기 좋은 곳',
      '숨은 맛집',
      '레트로 감성',
    ],
  ];

  return (
    <div style={s.page}>
      <StartNavbar />

      {/* 히어로 */}
      <div ref={heroRef} style={s.hero} className="sh-fade">
        <div style={s.heroText}>
          <p style={s.heroEyebrow}>AI 기반 로컬 여행 추천</p>
          <h1 style={s.heroTitle}>
            진짜 그 동네의
            <br />
            분위기를 담다.
          </h1>
          <p style={s.heroDesc}>
            LocalVibe는 데이터 기반 추천으로
            <br />
            숨은 로컬 스팟을 빠르게 찾도록 도와줍니다.
          </p>
          <button
            style={s.ctaBtn}
            className="sh-btn"
            onClick={() => navigate('/main')}
          >
            지금 시작하기 →
          </button>
        </div>
        <div style={s.heroImgWrap}>
          <div style={s.heroGradient} />
          <img
            src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80"
            alt="로컬 여행"
            style={s.heroImg}
          />
        </div>
      </div>

      {/* 바이브 태그 */}
      <div ref={vibeRef} style={s.section} className="sh-fade">
        <p style={s.sectionEyebrow}>EXPLORE</p>
        <h2 style={s.sectionTitle}>어떤 분위기를 찾고 있나요?</h2>
        {vibeRows.map((row, i) => (
          <div key={i} style={s.tagRow}>
            {row.map(tag => (
              <button
                key={tag}
                style={s.tag}
                className="sh-tag"
                onClick={() =>
                  navigate(`/main?query=${encodeURIComponent(tag)}`)
                }
              >
                {tag}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* 기술 카드 */}
      <div
        ref={techRef}
        style={{ ...s.section, background: '#f8f8f8', padding: '80px 0' }}
        className="sh-fade"
      >
        <div style={s.sectionInner}>
          <p style={s.sectionEyebrow}>HOW IT WORKS</p>
          <h2 style={s.sectionTitle}>데이터가 만드는 로컬 경험</h2>
          <div style={s.techGrid}>
            {[
              {
                icon: '🧠',
                title: 'AI-Hub 데이터',
                desc: '방문 패턴 기반 숨은 지역 분석',
              },
              {
                icon: '📡',
                title: '실시간 크롤링',
                desc: '네이버 블로그 기반 트렌드 반영',
              },
              {
                icon: '✨',
                title: '맞춤 추천',
                desc: '분위기·관계유형에 맞춘 개인화',
              },
            ].map((c, i) => (
              <div key={i} style={s.techCard} className="sh-card">
                <span style={s.techIcon}>{c.icon}</span>
                <h3 style={s.techTitle}>{c.title}</h3>
                <p style={s.techDesc}>{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA 배너 */}
      <div ref={ctaRef} style={s.ctaBanner} className="sh-fade">
        <div style={s.ctaInner}>
          <h2 style={s.ctaTitle}>
            지금 바로 로컬 바이브를
            <br />
            경험해보세요
          </h2>
          <button
            style={s.ctaBtn2}
            className="sh-btn2"
            onClick={() => navigate('/main')}
          >
            갤러리 둘러보기 →
          </button>
        </div>
      </div>

      {/* 푸터 */}
      <footer style={s.footer}>
        <div style={s.footerInner}>
          <div>
            <div style={s.footerBrand}>LocalVibe</div>
            <p style={s.footerDesc}>Discover real local stories with AI.</p>
          </div>
          <div style={s.footerLinks}>
            {['Core Features', 'Pro Experience', 'Contact', 'Join'].map(l => (
              <span key={l} style={s.footerLink}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <div style={s.footerBottom}>
          © {new Date().getFullYear()} LocalVibe. All rights reserved.
        </div>
      </footer>

      <style>{`
        .sh-fade { opacity: 0; transform: translateY(24px); transition: opacity 0.55s ease, transform 0.55s ease; }
        .sh-fade.sh-visible { opacity: 1; transform: translateY(0); }
        .sh-btn { transition: transform 150ms ease, box-shadow 150ms ease !important; }
        .sh-btn:hover { transform: translateY(-2px) !important; box-shadow: 0 6px 20px rgba(0,0,0,0.18) !important; }
        .sh-btn2 { transition: background 150ms ease, transform 150ms ease !important; }
        .sh-btn2:hover { background: #333 !important; transform: translateY(-2px) !important; }
        .sh-tag { transition: background 150ms ease, color 150ms ease, border-color 150ms ease !important; }
        .sh-tag:hover { background: #111 !important; color: #fff !important; border-color: #111 !important; }
        .sh-card { transition: transform 200ms ease, box-shadow 200ms ease !important; }
        .sh-card:hover { transform: translateY(-4px) !important; box-shadow: 0 10px 28px rgba(0,0,0,0.09) !important; }
      `}</style>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#ffffff' },
  hero: {
    maxWidth: 1300,
    width: '90%',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'clamp(48px,8vw,100px) 0',
    gap: 'clamp(24px,4vw,60px)',
  },
  heroText: { flex: 1 },
  heroEyebrow: {
    margin: '0 0 12px',
    fontSize: 12,
    fontWeight: 700,
    color: '#999',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
  },
  heroTitle: {
    margin: '0 0 clamp(14px,2vw,20px)',
    fontSize: 'clamp(36px,5.5vw,72px)',
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '-1px',
    color: '#111',
  },
  heroDesc: {
    margin: '0 0 clamp(20px,3vw,32px)',
    fontSize: 'clamp(15px,1.5vw,20px)',
    color: '#666',
    lineHeight: 1.7,
  },
  ctaBtn: {
    padding: 'clamp(12px,1vw,16px) clamp(24px,2.5vw,36px)',
    fontSize: 'clamp(14px,1.3vw,18px)',
    borderRadius: 8,
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
    border: 'none',
    fontWeight: 700,
    fontFamily: 'inherit',
    boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
  },
  heroImgWrap: { flex: 1, position: 'relative', maxWidth: 620 },
  heroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '35%',
    background: 'linear-gradient(to right, #fff 0%, transparent 100%)',
    zIndex: 1,
    borderRadius: '20px 0 0 20px',
  },
  heroImg: { width: '100%', borderRadius: 20, display: 'block' },

  section: {
    maxWidth: 1100,
    width: '90%',
    margin: '0 auto',
    padding: 'clamp(56px,8vw,96px) 0',
  },
  sectionInner: { maxWidth: 1100, width: '90%', margin: '0 auto' },
  sectionEyebrow: {
    margin: '0 0 10px',
    fontSize: 11,
    fontWeight: 700,
    color: '#bbb',
    letterSpacing: '2px',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    margin: '0 0 clamp(28px,4vw,48px)',
    fontSize: 'clamp(22px,3vw,40px)',
    fontWeight: 800,
    color: '#111',
    letterSpacing: '-0.4px',
  },

  tagRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  tag: {
    padding: '9px 18px',
    fontSize: 'clamp(13px,1.1vw,16px)',
    borderRadius: 999,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: '#333',
    fontWeight: 500,
  },

  techGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3,1fr)',
    gap: 20,
    marginTop: 8,
  },
  techCard: {
    padding: '28px 24px',
    borderRadius: 12,
    background: '#fff',
    border: '1px solid #eee',
    textAlign: 'left',
    cursor: 'default',
  },
  techIcon: { fontSize: 28, display: 'block', marginBottom: 12 },
  techTitle: {
    margin: '0 0 8px',
    fontSize: 16,
    fontWeight: 800,
    color: '#111',
  },
  techDesc: { margin: 0, fontSize: 14, color: '#666', lineHeight: 1.6 },

  feedCard: {
    display: 'flex',
    gap: 'clamp(24px,4vw,56px)',
    marginBottom: 'clamp(40px,6vw,72px)',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  feedImg: {
    width: '100%',
    maxWidth: 500,
    height: 280,
    objectFit: 'cover',
    borderRadius: 14,
    flex: '1 1 380px',
  },
  feedText: { flex: '1 1 280px' },
  feedLabel: {
    display: 'block',
    fontSize: 'clamp(16px,1.8vw,26px)',
    fontWeight: 800,
    color: '#111',
    marginBottom: 12,
  },
  feedDesc: {
    margin: 0,
    fontSize: 'clamp(13px,1.2vw,18px)',
    color: '#555',
    lineHeight: 1.75,
  },

  ctaBanner: { background: '#111', margin: '0' },
  ctaInner: {
    maxWidth: 800,
    width: '90%',
    margin: '0 auto',
    padding: 'clamp(48px,8vw,80px) 0',
    textAlign: 'center',
  },
  ctaTitle: {
    margin: '0 0 28px',
    fontSize: 'clamp(22px,3vw,42px)',
    fontWeight: 800,
    color: '#fff',
    lineHeight: 1.25,
  },
  ctaBtn2: {
    padding: '14px 32px',
    fontSize: 'clamp(14px,1.3vw,18px)',
    borderRadius: 8,
    background: '#fff',
    color: '#111',
    cursor: 'pointer',
    border: 'none',
    fontWeight: 700,
    fontFamily: 'inherit',
  },

  footer: {
    background: '#fff',
    borderTop: '1px solid #eee',
    padding: 'clamp(32px,5vw,56px) 0 24px',
  },
  footerInner: {
    maxWidth: 1100,
    width: '90%',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 24,
  },
  footerBrand: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111',
    marginBottom: 6,
  },
  footerDesc: { margin: 0, fontSize: 13, color: '#888' },
  footerLinks: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  footerLink: { fontSize: 13, color: '#888', cursor: 'pointer' },
  footerBottom: {
    maxWidth: 1100,
    width: '90%',
    margin: '20px auto 0',
    paddingTop: 16,
    borderTop: '1px solid #f0f0f0',
    fontSize: 12,
    color: '#bbb',
  },
};
