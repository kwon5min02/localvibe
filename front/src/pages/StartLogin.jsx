import { GoogleLogin } from "@react-oauth/google";
import { useNavigate } from "react-router-dom";
import StartNavbar from "../components/StartNavbar";

export default function StartLogin() {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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
      navigate("/main");
    } catch {
      window.alert("구글 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  };

  return (
    <div style={styles.page}>
      <StartNavbar hideDivider />
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Google 로그인</h2>
          <div style={styles.googleWrap}>
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
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#ffffff",
  },
  container: {
    display: "flex",
    justifyContent: "center",
    marginTop: "120px",
    padding: "0 16px",
  },
  card: {
    width: "100%",
    maxWidth: "360px",
    padding: "34px 28px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #eceff4",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
    textAlign: "center",
  },
  title: {
    margin: "0 0 14px",
    fontSize: "24px",
    lineHeight: 1.25,
    color: "#111827",
  },
  googleWrap: {
    display: "flex",
    justifyContent: "center",
  },
};
