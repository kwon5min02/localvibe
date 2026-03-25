import { useNavigate } from "react-router-dom";
import StartNavbar from "../components/StartNavbar";

export default function StartHome() {
  const navigate = useNavigate();

  const handleTagClick = (tag) => {
    navigate(`/main?query=${encodeURIComponent(tag)}`);
  };

  const vibeRows = [
    ["혼자 조용한 카페", "재즈 바", "노을 맛집", "힙한 골목", "로컬 술집", "야경 명소"],
    ["브런치 카페", "작은 갤러리", "감성 서점", "루프탑 바", "바다 근처 카페", "한적한 산책로"],
    ["디저트 맛집", "와인바", "라이브 공연", "사진 찍기 좋은 곳", "숨은 맛집", "레트로 감성"],
  ];

  return (
    <div>
      <StartNavbar />

      <div style={styles.container}>
        <div style={styles.textBox}>
          <h1 style={styles.title}>
            진짜 그 동네의 분위기를
            <br />
            담다.
          </h1>
          <p style={styles.desc}>
            LocalVibe는 데이터 기반 추천으로
            <br />
            숨은 로컬 스팟을 빠르게 찾도록 도와줍니다.
          </p>
          <button style={styles.cta} onClick={() => navigate("/main")}>
            시작하기
          </button>
        </div>

        <img
          src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=720&q=80"
          alt="city"
          style={styles.heroImage}
        />
      </div>

      <div style={styles.vibeSection}>
        <h2 style={styles.sectionTitle}>지금 어떤 분위기를 찾고 있나요?</h2>
        {vibeRows.map((row, rowIdx) => (
          <div key={rowIdx} style={styles.vibeRow}>
            {row.map((tag) => (
              <button key={tag} style={styles.tag} onClick={() => handleTagClick(tag)}>
                {tag}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={styles.techSection}>
        <h2 style={styles.sectionTitle}>데이터가 만드는 로컬 경험</h2>
        <div style={styles.cardWrap}>
          <div style={styles.card}>
            <h3>AI-Hub 데이터</h3>
            <p>방문 패턴 기반 숨은 지역 분석</p>
          </div>
          <div style={styles.card}>
            <h3>실시간 크롤링</h3>
            <p>실시간 트렌드 기반 최신 정보 반영</p>
          </div>
          <div style={styles.card}>
            <h3>AI 추천</h3>
            <p>입력한 분위기에 맞춘 맞춤형 추천</p>
          </div>
        </div>
      </div>

      <div style={styles.feedSection}>
        <h2 style={styles.sectionTitle}>AI가 만들어주는 로컬 피드</h2>

        <div style={styles.feedCard}>
          <img
            src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80"
            alt="전주 피드"
            style={styles.feedImage}
          />
          <div style={styles.feedText}>
            <h3 style={styles.feedTitle}>전주 · 한옥마을 뒷골목</h3>
            <p>
              북적이는 관광지를 벗어나면,
              재즈가 흐르는 작은 바가 있다.
              오늘 밤, 이 도시의 진짜 온도를 느껴보자.
            </p>
          </div>
        </div>

        <div style={styles.feedCard}>
          <img
            src="https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=800&q=80"
            alt="부산 피드"
            style={styles.feedImage}
          />
          <div style={styles.feedText}>
            <h3 style={styles.feedTitle}>부산 · 해운대 뒷카페</h3>
            <p>
              바다를 정면으로 보는 카페 말고,
              골목 안쪽의 작은 공간.
              커피 향과 파도 소리가 섞이는 곳.
            </p>
          </div>
        </div>
      </div>

      <div style={styles.footer}>
        <div style={styles.footerContent}>
          <div style={styles.footerLeft}>
            <h3 style={styles.footerBrand}>LocalVibe</h3>
            <p style={styles.footerDesc}>
              Discover real local stories with AI and data-driven insights.
            </p>
          </div>
          <div style={styles.footerRight}>
            <div style={styles.footerLinksGroup}>
              <h4 style={styles.footerLinksTitle}>Features</h4>
              <ul style={styles.linkList}>
                <li>
                  <a href="/main" style={styles.link}>Core Features</a>
                </li>
                <li>
                  <a href="/main" style={styles.link}>Pro Experience</a>
                </li>
              </ul>
            </div>
            <div style={styles.footerLinksGroup}>
              <h4 style={styles.footerLinksTitle}>Support</h4>
              <ul style={styles.linkList}>
                <li>
                  <a href="/login" style={styles.link}>Contact</a>
                </li>
                <li>
                  <a href="/signin" style={styles.link}>Join</a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div style={styles.footerBottom}>
          <p>© {new Date().getFullYear()} LocalVibe. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "1400px",
    width: "90%",
    margin: "0 auto",
    display: "flex",
    padding: "8vw 0",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "5vw",
  },
  textBox: {
    flex: 1,
  },
  title: {
    fontSize: "clamp(32px,5vw,70px)",
    fontWeight: "700",
    lineHeight: "1.2",
  },
  desc: {
    marginTop: "2vw",
    fontSize: "clamp(16px,1.8vw,26px)",
    color: "#666",
    lineHeight: "1.7",
  },
  cta: {
    marginTop: "3vw",
    padding: "1vw 2.5vw",
    fontSize: "clamp(16px,1.5vw,24px)",
    borderRadius: "12px",
    background: "#000",
    color: "#fff",
    cursor: "pointer",
    border: "none",
  },
  heroImage: {
    flex: 1,
    width: "100%",
    maxWidth: "600px",
    borderRadius: "20px",
  },
  vibeSection: {
    maxWidth: "1200px",
    width: "90%",
    margin: "8vw auto",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: "clamp(26px,3vw,48px)",
    fontWeight: "700",
  },
  vibeRow: {
    display: "flex",
    justifyContent: "center",
    gap: "16px",
    marginTop: "20px",
    flexWrap: "wrap",
  },
  tag: {
    padding: "12px 22px",
    fontSize: "clamp(14px,1.4vw,22px)",
    borderRadius: "30px",
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
  },
  techSection: {
    maxWidth: "1100px",
    width: "90%",
    margin: "12vw auto",
    textAlign: "center",
  },
  cardWrap: {
    display: "grid",
    gridTemplateColumns: "repeat(3,1fr)",
    gap: "24px",
    marginTop: "30px",
  },
  card: {
    padding: "30px",
    borderRadius: "20px",
    background: "#f8f8f8",
  },
  feedSection: {
    maxWidth: "1100px",
    width: "90%",
    margin: "12vw auto",
  },
  feedCard: {
    display: "flex",
    gap: "40px",
    marginTop: "70px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  feedImage: {
    width: "100%",
    maxWidth: "520px",
    height: "280px",
    objectFit: "cover",
    borderRadius: "20px",
    flex: "1 1 400px",
  },
  feedText: {
    flex: "1 1 300px",
    fontSize: "clamp(15px,1.4vw,22px)",
    lineHeight: "1.7",
  },
  feedTitle: {
    fontSize: "clamp(20px,2vw,32px)",
    fontWeight: "700",
    marginBottom: "12px",
  },
  footer: {
    maxWidth: "1200px",
    width: "90%",
    margin: "8vw auto",
    padding: "30px 0",
    borderTop: "1px solid #ddd",
    fontSize: "clamp(14px,1.2vw,18px)",
    color: "#444",
  },
  footerContent: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "40px",
  },
  footerLeft: {
    flex: "1 1 260px",
  },
  footerBrand: {
    fontSize: "clamp(20px,2vw,26px)",
    fontWeight: "700",
    marginBottom: "10px",
  },
  footerDesc: {
    lineHeight: "1.6",
    color: "#666",
  },
  footerRight: {
    flex: "2 1 500px",
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "30px",
  },
  footerLinksGroup: {
    minWidth: "120px",
  },
  footerLinksTitle: {
    fontSize: "clamp(16px,1.4vw,20px)",
    fontWeight: "600",
    marginBottom: "10px",
  },
  linkList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  link: {
    color: "#444",
    textDecoration: "none",
    display: "block",
    margin: "6px 0",
  },
  footerBottom: {
    marginTop: "30px",
    borderTop: "1px solid #eee",
    paddingTop: "16px",
    textAlign: "center",
    color: "#888",
    fontSize: "clamp(13px,1vw,16px)",
  },
};
