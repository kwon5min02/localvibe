/**
 * 문의하기 모달
 * 위치: src/components/ContactModal.jsx
 *
 * 사용법 (App.jsx 또는 사이드바에서):
 *   const [contactOpen, setContactOpen] = useState(false);
 *   <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />
 *
 *   사이드바 '📬 문의하기' 클릭 시 setContactOpen(true) 호출
 */

import { useRef, useState } from 'react';

const CATEGORIES = ['서비스 이용 문의', '버그 신고', '장소 정보 오류', '기능 제안', '기타'];

export default function ContactModal({ isOpen, onClose }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});
  const titleRef = useRef(null);

  if (!isOpen) return null;

  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = '제목을 입력해주세요.';
    if (!body.trim()) e.body = '문의 내용을 입력해주세요.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = '이메일 형식이 올바르지 않아요.';
    return e;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    // 실제 전송 없음 — "보내졌습니다" 팝업만 표시
    setSubmitted(true);
  };

  const handleClose = () => {
    setCategory(CATEGORIES[0]);
    setTitle('');
    setBody('');
    setEmail('');
    setSubmitted(false);
    setErrors({});
    onClose();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}
      onClick={handleClose}
      role="presentation"
    >
      <div
        style={{ background: '#fff', borderRadius: 16, width: 'min(520px, 95vw)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="문의하기"
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111' }}>📬 문의하기</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>LocalVibe 팀이 빠르게 확인할게요.</p>
          </div>
          <button type="button" onClick={handleClose} aria-label="닫기"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#aaa', lineHeight: 1, padding: 4 }}
          >✕</button>
        </div>

        {/* 완료 상태 */}
        {submitted ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#111' }}>문의가 접수되었어요!</h3>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#555', lineHeight: 1.6 }}>
              소중한 의견 감사해요. LocalVibe 팀이 검토 후 답변드릴게요.
            </p>
            {email && (
              <p style={{ margin: '0 0 32px', fontSize: 13, color: '#888' }}>
                답변은 <strong>{email}</strong>로 보내드려요.
              </p>
            )}
            <button type="button" onClick={handleClose}
              style={{ padding: '12px 32px', background: '#111', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              확인
            </button>
          </div>
        ) : (
          /* 폼 */
          <form onSubmit={handleSubmit} style={{ padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 카테고리 */}
            <div>
              <label style={labelStyle}>문의 유형</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat} type="button"
                    onClick={() => setCategory(cat)}
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      border: `1px solid ${category === cat ? '#111' : '#e5e5e5'}`,
                      background: category === cat ? '#111' : '#fff',
                      color: category === cat ? '#fff' : '#555',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms',
                    }}
                  >{cat}</button>
                ))}
              </div>
            </div>

            {/* 제목 */}
            <div>
              <label style={labelStyle} htmlFor="contact-title">제목 <span style={{ color: '#e05b6f' }}>*</span></label>
              <input
                id="contact-title" ref={titleRef}
                type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="문의 제목을 입력해주세요"
                style={{ ...inputStyle, borderColor: errors.title ? '#e05b6f' : '#e5e5e5' }}
              />
              {errors.title && <p style={errorStyle}>{errors.title}</p>}
            </div>

            {/* 내용 */}
            <div>
              <label style={labelStyle} htmlFor="contact-body">문의 내용 <span style={{ color: '#e05b6f' }}>*</span></label>
              <textarea
                id="contact-body"
                value={body} onChange={e => setBody(e.target.value)}
                placeholder="문의하실 내용을 자세히 적어주세요."
                rows={5}
                style={{ ...inputStyle, borderColor: errors.body ? '#e05b6f' : '#e5e5e5', resize: 'vertical', minHeight: 120 }}
              />
              {errors.body && <p style={errorStyle}>{errors.body}</p>}
            </div>

            {/* 이메일 */}
            <div>
              <label style={labelStyle} htmlFor="contact-email">답변 받을 이메일 <span style={{ color: '#aaa', fontWeight: 400 }}>(선택)</span></label>
              <input
                id="contact-email"
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="example@email.com"
                style={{ ...inputStyle, borderColor: errors.email ? '#e05b6f' : '#e5e5e5' }}
              />
              {errors.email && <p style={errorStyle}>{errors.email}</p>}
            </div>

            {/* 제출 */}
            <button
              type="submit"
              style={{ padding: '14px 0', background: '#111', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}
            >
              보내기
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  color: '#333',
  marginBottom: 4,
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
  margin: '4px 0 0',
  fontSize: 12,
  color: '#e05b6f',
};
