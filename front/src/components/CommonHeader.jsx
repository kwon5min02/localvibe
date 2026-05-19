import { GoogleLogin, googleLogout } from "@react-oauth/google";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export default function CommonHeader({ onTabChange }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    try { const raw = localStorage.getItem("lv_user"); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const loginRef = useRef(null);

  useEffect(() => {
    const sync = () => {
      try { const raw = localStorage.getItem("lv_user"); setUser(raw ? JSON.parse(raw) : null); } catch { setUser(null); }
    };
    window.addEventListener("storage", sync);
    window.addEventListener("lv-auth-changed", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("lv-auth-changed", sync); };
  }, []);

  useEffect(() => {
    if (!isLoginOpen) return;
    const handler = (e) => { if (loginRef.current && !loginRef.current.contains(e.target)) setIsLoginOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isLoginOpen]);

  const handleGoogleCredential = async (credential) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: credential }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const token = String(data?.access_token || "");
      const nextUser = data?.user || null;
      if (!token || !nextUser) throw new Error();
      localStorage.setItem("lv_access_token", token);
      localStorage.setItem("lv_user", JSON.stringify(nextUser));
      window.dispatchEvent(new Event("lv-auth-changed"));
      setIsLoginOpen(false);
    } catch { window.alert("구글 로그인에 실패했습니다."); }
  };

  const handleLogout = () => {
    googleLogout();
    localStorage.removeItem("lv_access_token");
    localStorage.removeItem("lv_user");
    window.dispatchEvent(new Event("lv-auth-changed"));
  };

  return (
    <div className="common-header-wrap">
      <div className="common-header-inner">
        {/* 로고 */}
        <h1 className="common-header-logo" onClick={() => navigate("/")}>LocalVibe</h1>

        {/* 중앙 네비 */}
        <nav className="common-header-nav">
          <span className="common-header-nav-link" onClick={() => onTabChange ? onTabChange('gallery') : navigate('/main')}>갤러리</span>
          <span className="common-header-nav-link" onClick={() => onTabChange ? onTabChange('planner') : navigate('/main')}>플래너</span>
          <span className="common-header-nav-link" onClick={() => navigate('/')}>소개</span>
        </nav>

        {/* 우측 */}
        <div className="common-header-right" ref={loginRef}>
          {user ? (
            <>
              {user.picture
                ? <img src={user.picture} alt="profile" className="common-header-avatar" />
                : <div className="common-header-avatar-fallback">{String(user.name || "U").slice(0, 1).toUpperCase()}</div>
              }
              <span className="common-header-user-name">{user.name || user.email}</span>
              <button className="common-header-btn" onClick={handleLogout}>로그아웃</button>
            </>
          ) : (
            <>
              <button className="common-header-btn" onClick={() => setIsLoginOpen(true)}>로그인</button>
              <button className="common-header-btn common-header-btn-primary" onClick={() => setIsLoginOpen(true)}>시작하기</button>
            </>
          )}
          {isLoginOpen && (
            <div className="common-header-login-panel">
              <p className="common-header-login-title">Google로 계속하기</p>
              <GoogleLogin
                theme="filled_black" size="large" text="signin_with"
                onSuccess={(cr) => { const c = cr?.credential || ""; if (c) handleGoogleCredential(c); }}
                onError={() => window.alert("Google 로그인 창을 불러오지 못했습니다.")}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
