import { useState } from 'react';

const CATEGORIES = [
  '서비스 이용 문의',
  '버그 신고',
  '장소 정보 오류',
  '기능 제안',
  '기타',
];

const FAQ_ITEMS = [
  {
    q: '장소 정보가 잘못되었어요.',
    a: '문의 유형에서 "장소 정보 오류"를 선택하고, 장소 이름·주소·잘못된 내용을 알려주세요. 검토 후 데이터를 수정해요.',
  },
  {
    q: '추천이 원하는 결과와 달라요.',
    a: '검색어나 지역 필터를 바꿔 보시고, 원하는 분위기·카테고리를 문의 내용에 적어 주시면 개선에 참고해요.',
  },
  {
    q: '스크랩한 장소가 사라졌어요.',
    a: '로그인 상태와 동일한 계정인지 확인해 주세요. 계속 보이지 않으면 장소 이름과 스크랩 시점을 알려주시면 확인할게요.',
  },
  {
    q: '새로운 기능을 제안하고 싶어요.',
    a: '문의 유형에서 "기능 제안"을 선택하고 아이디어를 자세히 적어 주세요. 팀에서 검토 후 답변드려요.',
  },
];

export default function ContactPage() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({});
  const [openFaq, setOpenFaq] = useState(null);

  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = '제목을 입력해주세요.';
    if (!body.trim()) e.body = '문의 내용을 입력해주세요.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.email = '이메일 형식이 올바르지 않아요.';
    }
    return e;
  };

  const handleSubmit = e => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitted(true);
  };

  const handleReset = () => {
    setCategory(CATEGORIES[0]);
    setTitle('');
    setBody('');
    setEmail('');
    setSubmitted(false);
    setErrors({});
    setOpenFaq(null);
  };

  if (submitted) {
    return (
      <div className="contact-page">
        <div className="contact-panel contact-panel--success">
          <div className="contact-success">
            <div className="contact-success-icon" aria-hidden>
              ✓
            </div>
            <h2 className="contact-success-title">문의가 접수되었어요</h2>
            <p className="contact-success-desc">
              소중한 의견 감사해요. 영업일 기준 1-3일 내 검토 후 답변드릴게요.
            </p>
            {email ? (
              <p className="contact-success-email">
                답변은 <strong>{email}</strong>로 보내드려요.
              </p>
            ) : null}
            <button
              type="button"
              className="contact-submit-btn contact-success-btn"
              onClick={handleReset}
            >
              새 문의 작성
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="contact-page">
      <div className="contact-panel">
        <div className="contact-layout">
          <section
            className="contact-form-card"
            aria-labelledby="contact-form-heading"
          >
            <h2 id="contact-form-heading" className="contact-section-title">
              문의 작성
            </h2>

            <form className="contact-form" onSubmit={handleSubmit} noValidate>
              <div className="contact-field">
                <span className="contact-label">문의 유형</span>
                <div
                  className="contact-category-row"
                  role="group"
                  aria-label="문의 유형"
                >
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      className={`contact-pill${category === cat ? ' active' : ''}`}
                      onClick={() => setCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="contact-field">
                <label className="contact-label" htmlFor="contact-title">
                  제목 <span className="contact-required">*</span>
                </label>
                <input
                  id="contact-title"
                  type="text"
                  className={`contact-input${errors.title ? ' invalid' : ''}`}
                  value={title}
                  onChange={ev => setTitle(ev.target.value)}
                  placeholder="문의 제목을 입력해주세요"
                />
                {errors.title ? (
                  <p className="contact-error">{errors.title}</p>
                ) : null}
              </div>

              <div className="contact-field">
                <label className="contact-label" htmlFor="contact-body">
                  문의 내용 <span className="contact-required">*</span>
                </label>
                <textarea
                  id="contact-body"
                  className={`contact-textarea${errors.body ? ' invalid' : ''}`}
                  value={body}
                  onChange={ev => setBody(ev.target.value)}
                  placeholder="문의하실 내용을 자세히 적어주세요."
                  rows={7}
                />
                {errors.body ? (
                  <p className="contact-error">{errors.body}</p>
                ) : null}
              </div>

              <div className="contact-field">
                <label className="contact-label" htmlFor="contact-email">
                  답변 받을 이메일{' '}
                  <span className="contact-optional">(선택)</span>
                </label>
                <input
                  id="contact-email"
                  type="email"
                  className={`contact-input${errors.email ? ' invalid' : ''}`}
                  value={email}
                  onChange={ev => setEmail(ev.target.value)}
                  placeholder="example@email.com"
                />
                <p className="contact-hint">
                  입력하지 않으면 답변을 받을 수 없어요.
                </p>
                {errors.email ? (
                  <p className="contact-error">{errors.email}</p>
                ) : null}
              </div>

              <button type="submit" className="contact-submit-btn">
                보내기
              </button>
            </form>
          </section>

          <aside className="contact-aside">
            <div className="contact-notice-box">
              <h3 className="contact-notice-title">응답 안내</h3>
              <p className="contact-notice-body">
                영업일 기준 1-3일 내 검토 후 답변드려요. 긴급한 오류는
                &apos;버그 신고&apos;로 접수해주세요.
              </p>
            </div>

            <div className="contact-faq">
              <h3 className="contact-faq-heading">
                <span className="contact-faq-heading-icon" aria-hidden>
                  🔍
                </span>
                자주 묻는 질문
              </h3>
              <ul className="contact-faq-list">
                {FAQ_ITEMS.map((item, idx) => {
                  const open = openFaq === idx;
                  return (
                    <li
                      key={item.q}
                      className={`contact-faq-item${open ? ' open' : ''}`}
                    >
                      <button
                        type="button"
                        className={`contact-faq-trigger${open ? ' open' : ''}`}
                        onClick={() => setOpenFaq(open ? null : idx)}
                        aria-expanded={open}
                      >
                        <span className="contact-faq-q">{item.q}</span>
                        <span className="contact-faq-chevron" aria-hidden />
                      </button>
                      <div
                        className={`contact-faq-body${open ? ' open' : ''}`}
                        aria-hidden={!open}
                      >
                        <p className="contact-faq-answer">{item.a}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
