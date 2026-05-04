import { GoogleLogin, googleLogout } from '@react-oauth/google';

export default function TopHeader({ user, onGoogleCredential, onLogout }) {
  return (
    <header className="top-header">
      <div className="top-header-brand">LocalVibe</div>
      <nav className="top-header-nav">
        <span>갤러리</span>
        <span>플래너</span>
        <span>소개</span>
      </nav>
      <div className="top-header-actions">
        {user ? (
          <>
            <span className="top-header-user">{user.name || user.email}</span>
            <button
              type="button"
              className="top-header-btn ghost"
              onClick={() => {
                googleLogout();
                onLogout?.();
              }}
            >
              로그아웃
            </button>
          </>
        ) : (
          <GoogleLogin
            theme="filled_black"
            size="medium"
            text="signin_with"
            onSuccess={credentialResponse => {
              const credential = credentialResponse?.credential || '';
              if (credential) {
                onGoogleCredential?.(credential);
              }
            }}
            onError={() => {
              // no-op
            }}
          />
        )}
      </div>
    </header>
  );
}
