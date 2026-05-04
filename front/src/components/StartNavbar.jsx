import { GoogleLogin, googleLogout } from "@react-oauth/google";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function StartNavbar({ hideDivider = false }) {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("lv_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const syncUser = () => {
      try {
        const raw = localStorage.getItem("lv_user");
        setUser(raw ? JSON.parse(raw) : null);
      } catch {
        setUser(null);
      }
    };
    window.addEventListener("storage", syncUser);
    window.addEventListener("lv-auth-changed", syncUser);
    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("lv-auth-changed", syncUser);
    };
  }, []);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const loginMenuRef = useRef(null);

  const handleGoogleCredential = async (credential) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: credential }),
      });
      if (!response.ok) {
        throw new Error("google login failed");
      }
      const data = await response.json();
      const nextToken = String(data?.access_token || "");
      const nextUser = data?.user || null;
      if (!nextToken || !nextUser) {
        throw new Error("invalid auth response");
      }
      localStorage.setItem("lv_access_token", nextToken);
      localStorage.setItem("lv_user", JSON.stringify(nextUser));
      window.dispatchEvent(new Event("lv-auth-changed"));
      setIsLoginModalOpen(false);
    } catch {
      window.alert("구글 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  };

  useEffect(() => {
    if (!isLoginModalOpen) {
      return;
    }
    const handleOutsideClick = (event) => {
      if (!loginMenuRef.current) {
        return;
      }
      if (!loginMenuRef.current.contains(event.target)) {
        setIsLoginModalOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isLoginModalOpen]);

  return (
    <div style={{ ...styles.nav, borderBottom: hideDivider ? "none" : styles.nav.borderBottom }}>
      <h1 style={styles.logo} onClick={() => navigate("/")}>
        LocalVibe
      </h1>

      <div style={styles.right} ref={loginMenuRef}>
        {user ? (
          <>
            <div style={styles.profileWrap}>
              {user.picture ? (
                <img src={user.picture} alt="profile" style={styles.avatar} />
              ) : (
                <div style={styles.avatarFallback}>
                  {String(user.name || user.email || "U").slice(0, 1).toUpperCase()}
                </div>
              )}
              <span style={styles.profileName}>{user.name || user.email}</span>
            </div>
            <button
              style={styles.btn}
              onClick={() => {
                googleLogout();
                localStorage.removeItem("lv_access_token");
                localStorage.removeItem("lv_user");
                window.dispatchEvent(new Event("lv-auth-changed"));
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <button style={styles.btn} onClick={() => setIsLoginModalOpen(true)}>
              Login
            </button>
            <button style={styles.btn} onClick={() => setIsLoginModalOpen(true)}>
              Sign in
            </button>
          </>
        )}
        {isLoginModalOpen ? (
          <div style={styles.inlineLoginPanel}>
            <GoogleLogin
              theme="filled_blue"
              size="large"
              text="signin_with"
              onSuccess={(credentialResponse) => {
                const credential = credentialResponse?.credential || "";
                if (credential) {
                  handleGoogleCredential(credential);
                }
              }}
              onError={() => {
                window.alert("Google 로그인 창을 불러오지 못했습니다.");
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  nav: {
    maxWidth: "1400px",
    width: "90%",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 0 14px",
    borderBottom: "1px solid rgba(227, 233, 243, 0.9)",
    flexWrap: "wrap",
  },
  logo: {
    fontSize: "clamp(26px,3vw,46px)",
    fontWeight: "800",
    cursor: "pointer",
    margin: 0,
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    position: "relative",
  },
  profileWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    maxWidth: "240px",
  },
  avatar: {
    width: "32px",
    height: "32px",
    borderRadius: "999px",
    objectFit: "cover",
    border: "1px solid #ddd",
  },
  avatarFallback: {
    width: "32px",
    height: "32px",
    borderRadius: "999px",
    background: "#ddd",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "14px",
    color: "#333",
  },
  profileName: {
    fontSize: "14px",
    color: "#222",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  btn: {
    padding: "10px 18px",
    fontSize: "clamp(14px,1.2vw,20px)",
    borderRadius: "10px",
    cursor: "pointer",
    border: "none",
    background: "#000",
    color: "#fff",
  },
  inlineLoginPanel: {
    position: "absolute",
    top: "calc(100% + 10px)",
    right: 0,
    borderRadius: "14px",
    background: "#fff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 12px 28px rgba(17, 24, 39, 0.16)",
    padding: "14px",
    zIndex: 2000,
  },
};
