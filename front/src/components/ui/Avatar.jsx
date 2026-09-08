import { useState } from 'react';

/**
 * 프로필 아바타.
 * 구글 아바타(lh3.googleusercontent.com)는 referrer가 붙으면 403/429로 막히는 일이 있어
 * referrerPolicy="no-referrer"로 요청하고, 그래도 실패하면 이니셜로 대체합니다.
 */
export default function Avatar({
  src,
  name,
  className = '',
  fallbackClassName = '',
  style,
}) {
  // 0 = 원본, 1 = 캐시 우회 재시도, 2 = 포기(이니셜)
  const [attempt, setAttempt] = useState(0);
  const initial = String(name || 'U').slice(0, 1).toUpperCase();

  if (!src || attempt > 1) {
    return (
      <div className={`${className} ${fallbackClassName}`.trim()} style={style}>
        {initial}
      </div>
    );
  }

  // 한 번 실패한 응답이 브라우저에 캐시되면 계속 실패하므로 쿼리를 붙여 다시 받아옵니다.
  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=1`;

  return (
    <img
      key={url}
      src={url}
      alt=""
      className={className}
      style={style}
      referrerPolicy="no-referrer"
      onError={() => setAttempt(a => a + 1)}
    />
  );
}
