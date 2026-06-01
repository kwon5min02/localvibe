/**
 * 문의하기 페이지
 * 위치: src/pages/ContactPage.jsx
 */

import { useState } from 'react';

const CATEGORIES = ['서비스 이용 문의', '버그 신고', '장소 정보 오류', '기능 제안', '기타'];

const FAQ_ITEMS = [
  {
    //icon: '📍',
    q: '장소 정보가 잘못되었어요.',
    a: '"장소 정보 오류"를 선택하고 장소명과 오류 내용을 알려주세요. 빠르게 수정할게요.',
  },
  {
    //icon: '🔍',
    q: '추천이 원하는 결과와 달라요.',
    a: '"여수 야경 커플"처럼 지역, 분위기, 동행을 함께 입력하면 더 정확한 추천을 받을 수 있어요.',
  },
  {
    //icon: '♥',
    q: '스크랩한 장소가 사라졌어요.',
    a: '로그인 상태에서 스크랩하면 서버에 저장돼요. 비로그인 상태에서는 브라우저가 바뀌면 사라질 수 있어요.',
  },
  {
    //icon: '💡',
    q: '새로운 기능을 제안하고 싶어요.',
    a: '"기능 제안"을 선택하고 원하시는 기능을 자세히 설명해주세요. 팀에서 적극 검토할게요.',
  },
];

export default function ContactPage() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = '제목을 입력해주세요.';
    if (!body.trim()) e.body = '문의 내용을 입력해주세요.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = '이메일 형식이 올바르지 않아요.';
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitted(true);
  };

  const handleReset = () => {
    setCategory(CATEGORIES[0]);
    setTitle(''); setBody(''); setEmail('');
    setSubmitted(false); setErrors({});
  };

  return (
    <section style={{ width: '100%', marginTop: 20 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 300px',
        gap: 24,
        alignItems: 'start',
      }}>

        {/* ── 좌측: 폼 or 완료 ── */}
        <div style={{
          border: '1px solid #e5e5e5', borderRadius: 12,
          background: '#fff', overflow: 'hidden',
        }}>
          {submitted ? (
            /* 완료 화면 */
            <div style={{ padding: '48px 36px', textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
              <h3 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800, color: '#111' }}>
                문의가 접수되었어요!
              </h3>
              <p style={{ margin: '0 0 6px', fontSize: 14, color: '#555', lineHeight: 1.8 }}>
                소중한 의견 감사해요.<br />
                LocalVibe 팀이 검토 후 답변드릴게요.
              </p>
              {email && (
                <p style={{ margin: '0 0 32px', fontSize: 13, color: '#999' }}>
                  답변은 <strong style={{ color: '#111' }}>{email}</strong>로 보내드려요.
                </p>
              )}
              <button type="button" onClick={handleReset} style={secondaryBtnStyle}>
                추가 문의하기
              </button>
            </div>
          ) : (
            /* 폼 */
            <form onSubmit={handleSubmit}>
              {/* 폼 헤더 */}
              <div style={{
                padding: '20px 24px 18px',
                borderBottom: '1px solid #f0f0f0',
              }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111' }}>
                  문의 작성
                </h2>
              </div>

              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* 카테고리 */}
                <div>
                  <div style={labelStyle}>문의 유형</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat} type="button"
                        onClick={() => setCategory(cat)}
                        style={{
                          padding: '6px 12px', borderRadius: 999,
                          fontSize: 12, fontWeight: 600,
                          border: `1px solid ${category === cat ? '#111' : '#e5e5e5'}`,
                          background: category === cat ? '#111' : '#fff',
                          color: category === cat ? '#fff' : '#666',
                          cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'all 150ms',
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 제목 */}
                <div>
                  <label style={labelStyle} htmlFor="ct-title">
                    제목 <span style={{ color: '#e05b6f' }}>*</span>
                  </label>
                  <input
                    id="ct-title" type="text" value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="문의 제목을 입력해주세요"
                    style={{ ...inputStyle, borderColor: errors.title ? '#e05b6f' : '#e5e5e5' }}
                  />
                  {errors.title && <p style={errorStyle}>{errors.title}</p>}
                </div>

                {/* 내용 */}
                <div>
                  <label style={labelStyle} htmlFor="ct-body">
                    문의 내용 <span style={{ color: '#e05b6f' }}>*</span>
                  </label>
                  <textarea
                    id="ct-body" value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder="문의하실 내용을 자세히 적어주세요."
                    rows={6}
                    style={{
                      ...inputStyle,
                      borderColor: errors.body ? '#e05b6f' : '#e5e5e5',
                      resize: 'vertical', minHeight: 130, lineHeight: 1.7,
                    }}
                  />
                  {errors.body && <p style={errorStyle}>{errors.body}</p>}
                </div>

                {/* 이메일 */}
                <div>
                  <label style={labelStyle} htmlFor="ct-email">
                    답변 받을 이메일{' '}
                    <span style={{ color: '#aaa', fontWeight: 400 }}>(선택)</span>
                  </label>
                  <input
                    id="ct-email" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    style={{ ...inputStyle, borderColor: errors.email ? '#e05b6f' : '#e5e5e5' }}
                  />
                  {errors.email && <p style={errorStyle}>{errors.email}</p>}
                  <p style={{ margin: '5px 0 0', fontSize: 11, color: '#bbb' }}>
                    입력하지 않으면 답변을 받을 수 없어요.
                  </p>
                </div>

                {/* 제출 */}
                <button type="submit" style={primaryBtnStyle}>
                  보내기
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── 우측: FAQ ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 응답 안내 */}
          <div style={{
            padding: '16px 18px',
            background: '#111', borderRadius: 10, color: '#fff',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>
              응답 안내
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)' }}>
              영업일 기준 <strong style={{ color: '#fff' }}>1~3일</strong> 내 검토 후 답변드려요.
              긴급한 오류는 "버그 신고"로 접수해주세요.
            </p>
          </div>

          {/* FAQ */}
          <div style={{
            border: '1px solid #e5e5e5', borderRadius: 10,
            background: '#fff', overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 18px 12px',
              borderBottom: '1px solid #f0f0f0',
            }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111' }}>
                🔍 자주 묻는 질문
              </h3>
            </div>
            <div>
              {FAQ_ITEMS.map((item, i) => (
                <FaqItem
                  key={i}
                  icon={item.icon}
                  question={item.q}
                  answer={item.a}
                  isLast={i === FAQ_ITEMS.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqItem({ icon, question, answer, isLast }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid #f5f5f5' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          padding: '13px 18px',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#222', lineHeight: 1.4 }}>
          {question}
        </span>
        <span style={{
          fontSize: 9, color: '#ccc', flexShrink: 0,
          display: 'inline-block', transition: 'transform 200ms',
          transform: open ? 'rotate(180deg)' : 'none',
        }}>▼</span>
      </button>
      {open && (
        <div style={{
          padding: '0 18px 14px 43px',
          fontSize: 12, color: '#777', lineHeight: 1.8,
        }}>
          {answer}
        </div>
      )}
    </div>
  );
}

// ── 스타일 상수 ───────────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  color: '#333',
  marginBottom: 6,
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  color: '#111',
  background: '#fff',
  transition: 'border-color 150ms',
};

const errorStyle = {
  margin: '5px 0 0',
  fontSize: 12,
  color: '#e05b6f',
};

const primaryBtnStyle = {
  width: '100%',
  height: 44,
  background: '#111',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const secondaryBtnStyle = {
  height: 40,
  padding: '0 20px',
  background: '#fff',
  color: '#111',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
