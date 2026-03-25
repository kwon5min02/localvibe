import { useNavigate } from "react-router-dom";

function Navbar() {
  const navigate = useNavigate();

  return (
    <div style={styles.nav}>
      <h1 style={styles.logo} onClick={() => navigate("/")}>
        LocalVibe
      </h1>

    <div style={styles.right}>
      <button style={styles.btn} onClick={() => navigate("/login")}>
        Login
      </button>
      <button style={styles.btn} onClick={() => navigate("/signin")}>
        Sign in
      </button>
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
    padding: "20px 0",
    borderBottom: "1px solid #eee",
    flexWrap: "wrap",
  },

  logo: {
    fontSize: "clamp(26px,3vw,46px)",
    fontWeight: "800",
    cursor: "pointer",
  },

  right: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
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
};

export default Navbar;