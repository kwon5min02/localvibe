import { useState, useRef } from "react";
import KakaoMap from "./KakaoMap";

/* ── 인사이트 정규화 ── */
function normalizeInsightValues(values = []) {
  const seen = new Set();
  return values.reduce((acc, raw) => {
    const v = String(raw || "").trim();
    if (!v || v === "정보를 제공 받을 수 없습니다." || /^\d+$/.test(v) || seen.has(v)) return acc;
    seen.add(v); acc.push(v); return acc;
  }, []);
}

function buildFallbackValues(title, region) {
  const place = String(region?.name || "").trim();
  if (title === "추천 업종") return ["로컬 관광", "식음료", "체험형 방문"];
  if (title === "혼잡 시간대") return ["주말 13:00-17:00", "공휴일 오후"];
  return place ? [`${place} 관심 방문객`, "로컬 여행객"] : ["로컬 여행객", "당일 방문객"];
}

function toCardItems(region) {
  return [
    { title: "추천 업종", values: region.recommendedBusinesses || [] },
    { title: "혼잡 시간대", values: region.busyHours || [] },
    { title: "예상 고객층", values: region.targetCustomers || [] },
  ].map(card => {
    const cleaned = normalizeInsightValues(card.values);
    return { ...card, values: cleaned.length > 0 ? cleaned.slice(0, 4) : buildFallbackValues(card.title, region) };
  });
}

function resolveMediaUrl(url, apiBaseUrl) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  return u.startsWith("/") && base ? `${base}${u}` : u;
}

/* ── 하드코딩 아티클 (백엔드 연동 전) ── */
function generateArticle(region) {
  const name = region?.name || "이 장소";
  const regionName = region?.region || region?.province || "이 지역";
  const summary = region?.summary || "";
  return {
    title: `${name}, 로컬이 사랑하는 이유`,
    author: "LocalVibe 에디터",
    date: new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }),
    body: [
      {
        type: "lead",
        text: `${regionName}에서 진짜 로컬을 만나고 싶다면, 관광지도를 잠시 접어두자. ${name}은 그런 곳이다. 화려한 간판도, SNS 인증샷 명소도 아니지만, 한 번 발걸음을 들인 사람은 꼭 다시 찾게 되는 장소.`,
      },
      {
        type: "subheader",
        text: "지역이 품은 이야기",
      },
      {
        type: "paragraph",
        text: `${regionName}은 최근 몇 년 사이 조용한 변화를 겪고 있다. 젊은 로컬 창업자들이 하나둘 골목에 둥지를 틀기 시작했고, 오래된 가게들 사이에 새로운 공간이 들어서며 독특한 레이어가 생겨났다. ${name}도 그 흐름 속에서 탄생한 공간이다.`,
      },
      {
        type: "paragraph",
        text: summary || `처음에는 동네 주민들의 단골 장소로 알려졌다. 특별한 마케팅도 없었고, 리뷰를 부탁하는 일도 없었다. 그저 꾸준하게, 자기만의 방식으로 자리를 지켰다. 입소문은 자연스럽게 퍼졌고, 이제는 이 지역을 여행하는 사람들이 꼭 한 번 들르는 곳이 됐다.`,
      },
      {
        type: "subheader",
        text: "공간이 주는 감각",
      },
      {
        type: "paragraph",
        text: `${name}에 들어서면 어딘가 서두르지 않아도 된다는 느낌이 든다. 공간은 사람을 밀어내지 않는다. 창밖으로 보이는 ${regionName}의 골목, 테이블 위의 작은 소품들, 잔잔하게 깔린 음악까지 — 모든 것이 그 자리에 있어야 할 이유를 갖고 있다.`,
      },
      {
        type: "quote",
        text: `"처음 왔을 때 그냥 지나칠 뻔했어요. 간판이 너무 작아서요. 근데 이제는 ${regionName} 오면 꼭 들르는 곳이 됐어요."`,
        attribution: "— 방문객 후기",
      },
      {
        type: "subheader",
        text: "방문 전 알아두면 좋은 것",
      },
      {
        type: "paragraph",
        text: `주말 오후는 사람이 몰린다. 여유롭게 즐기고 싶다면 평일 오전이나 저녁 시간대를 노리는 게 좋다. 대중교통 접근성도 나쁘지 않지만, 걸어서 주변 골목을 함께 둘러보는 걸 추천한다. ${regionName}의 진짜 매력은 지도 바깥에 있으니까.`,
      },
      {
        type: "paragraph",
        text: `처음 방문이라면 이 공간이 제안하는 방식 그대로 따라가 보자. 두 번째 방문부터는 자기만의 루틴이 생긴다. 그게 로컬 스팟의 진짜 매력이다.`,
      },
    ],
  };
}

/* ── 이미지 캐러셀 ── */
function ImageCarousel({ images, fallback }) {
  const [current, setCurrent] = useState(0);
  const startX = useRef(null);
  const allImages = images.length > 0 ? images : [fallback];
  const total = allImages.length;

  const prev = () => setCurrent(c => (c - 1 + total) % total);
  const next = () => setCurrent(c => (c + 1) % total);

  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (startX.current === null) return;
    const diff = startX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? next() : prev();
    startX.current = null;
  };

  return (
    <div style={{ position: "relative", width: "100%", height: 280, overflow: "hidden", background: "#f0f0f0" }}>
      {/* 이미지 */}
      <img
        src={allImages[current]}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "opacity 0.3s ease" }}
        onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = fallback; }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      />

      {/* 좌우 버튼 */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(0,0,0,0.35)", border: "none", color: "#fff",
              fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >‹</button>
          <button
            type="button"
            onClick={next}
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(0,0,0,0.35)", border: "none", color: "#fff",
              fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >›</button>
        </>
      )}

      {/* 인디케이터 */}
      {total > 1 && (
        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 }}>
          {allImages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? 18 : 6, height: 6, borderRadius: 999,
                background: i === current ? "#fff" : "rgba(255,255,255,0.45)",
                border: "none", cursor: "pointer", padding: 0,
                transition: "width 200ms, background 200ms",
              }}
            />
          ))}
        </div>
      )}

      {/* 이미지 카운트 */}
      {total > 1 && (
        <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
          {current + 1} / {total}
        </div>
      )}
    </div>
  );
}

/* ── 아티클 렌더러 ── */
function ArticleBody({ blocks }) {
  return (
    <div style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      {blocks.map((block, i) => {
        if (block.type === "lead") return (
          <p key={i} style={{ fontSize: 15, lineHeight: 1.9, color: "#222", fontWeight: 400, margin: "0 0 20px", borderLeft: "3px solid #111", paddingLeft: 14, fontStyle: "normal" }}>
            {block.text}
          </p>
        );
        if (block.type === "subheader") return (
          <h4 key={i} style={{ fontSize: 15, fontWeight: 700, color: "#111", margin: "24px 0 10px", fontFamily: "'Pretendard', sans-serif", letterSpacing: "-0.2px" }}>
            {block.text}
          </h4>
        );
        if (block.type === "paragraph") return (
          <p key={i} style={{ fontSize: 14, lineHeight: 1.95, color: "#333", margin: "0 0 16px" }}>
            {block.text}
          </p>
        );
        if (block.type === "quote") return (
          <blockquote key={i} style={{ margin: "20px 0", padding: "14px 18px", background: "#f8f8f8", borderRadius: 8, borderLeft: "none" }}>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: "#444", fontStyle: "normal", margin: "0 0 6px" }}>{block.text}</p>
            {block.attribution && <cite style={{ fontSize: 12, color: "#888", fontStyle: "normal" }}>{block.attribution}</cite>}
          </blockquote>
        );
        return null;
      })}
    </div>
  );
}

/* ── 메인 모달 ── */
const FALLBACK_IMG = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80";

export default function RegionModal({
  region, isLoading, onClose, apiBaseUrl = "",
  crawlImageUrls = [], article = null, articleLoading = false,
  scrappedIds = [], onToggleScrap, onAddToTrip,
}) {
  if (!region) return null;

  const cards = toCardItems(region);
  const isScrapped = scrappedIds.includes(region.id);

  // 이미지 목록: 크롤링 이미지 + 대표 이미지
  const allImages = [
    ...(region.imageUrl ? [region.imageUrl] : []),
    ...crawlImageUrls.map(u => resolveMediaUrl(u, apiBaseUrl)),
  ].filter(Boolean);

  // 아티클: 백엔드 연동 전엔 하드코딩
  // 백엔드 아티클이 실제 내용 있을 때만 사용, 에러/빈값이면 하드코딩 폴백
  const hasRealArticle = article &&
    (article.title || article.content) &&
    !String(article.content || "").includes("오류") &&
    !String(article.content || "").includes("불러오지 못") &&
    String(article.content || "").length > 30;

  const articleData = hasRealArticle
    ? { title: article.title || generateArticle(region).title, author: "LocalVibe AI", date: "", body: [{ type: "paragraph", text: article.content }] }
    : generateArticle(region);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.58)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 }}
      role="presentation"
      onClick={onClose}
    >
      <article
        style={{ position: "relative", width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 16, zIndex: 2001, boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >

        {/* ── 상단 헤더 (닫기 + 액션 버튼) ── */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)", borderBottom: "1px solid #f0f0f0" }}>
          {/* 닫기 */}
          <button type="button" onClick={onClose} aria-label="닫기" style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 20, lineHeight: 1, padding: 2, display: "flex", alignItems: "center" }}>←</button>

          {/* 장소명 (짧게) */}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{region.name}</span>

          {/* 스크랩 + 담기 */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => onToggleScrap?.(region.id)}
              title={isScrapped ? "스크랩 해제" : "스크랩"}
              style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #eee", background: "#fff", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", color: isScrapped ? "#e05b6f" : "#ccc", transition: "all 150ms" }}
            >
              {isScrapped ? "♥" : "♡"}
            </button>
            <button
              type="button"
              onClick={() => onAddToTrip?.(region)}
              style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
            >
              + 담기
            </button>
          </div>
        </div>

        {/* ── 이미지 캐러셀 ── */}
        <ImageCarousel images={allImages} fallback={FALLBACK_IMG} />

        {/* ── 아티클 본문 ── */}
        <div style={{ padding: "24px 24px 0" }}>
          {/* 제목 */}
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#111", lineHeight: 1.25, letterSpacing: "-0.4px", fontFamily: "'Pretendard', sans-serif" }}>
            {articleData.title}
          </h1>

          {/* 메타 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0" }}>
            <span style={{ fontSize: 12, color: "#888" }}>{articleData.author}</span>
            {articleData.date && <><span style={{ color: "#ddd" }}>·</span><span style={{ fontSize: 12, color: "#aaa" }}>{articleData.date}</span></>}
            {region.region && <><span style={{ color: "#ddd" }}>·</span><span style={{ fontSize: 12, color: "#aaa" }}>📍 {region.region}</span></>}
          </div>

          {/* 아티클 로딩 중 */}
          {articleLoading && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>AI 아티클 생성 중…</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#ddd", animation: "skeleton-bounce 1.2s infinite ease-in-out", animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* 아티클 본문 */}
          {!articleLoading && <ArticleBody blocks={articleData.body} />}

          {/* 주소 */}
          {region.address && (
            <p style={{ margin: "0 0 0", fontSize: 12, color: "#aaa", paddingTop: 4 }}>📍 {region.address}</p>
          )}
        </div>

        {/* ── 구분선 ── */}
        <div style={{ margin: "24px 24px 0", borderTop: "1px solid #f0f0f0" }} />

        {/* ── 장소 인사이트 ── */}
        <div style={{ padding: "20px 24px 0" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Pretendard', sans-serif" }}>
            장소 인사이트
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
            {cards.map(card => (
              <div key={card.title} style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px 12px", background: "#fafafa" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, fontFamily: "'Pretendard', sans-serif" }}>{card.title}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {card.values.map(v => (
                    <span key={v} style={{ display: "inline-flex", alignItems: "center", padding: "2px 7px", borderRadius: 999, border: "1px solid #eee", background: "#fff", color: "#555", fontSize: 10, fontWeight: 500 }}>{v}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 위치 지도 ── */}
        <div style={{ padding: "20px 24px 0" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "1px", fontFamily: "'Pretendard', sans-serif" }}>
            위치
          </h3>
          <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #eee" }}>
            <KakaoMap address={region.address} latitude={region.latitude} longitude={region.longitude} />
          </div>
          {region.address && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#888" }}>📍 {region.address}</p>
          )}
        </div>

        {/* ── 하단 여백 ── */}
        <div style={{ height: 32 }} />

        {isLoading && (
          <div style={{ position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 12, padding: "6px 14px", borderRadius: 999 }}>
            데이터 불러오는 중…
          </div>
        )}
      </article>
    </div>
  );
}
