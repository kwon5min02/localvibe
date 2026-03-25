import StartNavbar from "../components/StartNavbar";

export default function StartLogin() {
  return (
    <div>
      <StartNavbar />
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Log in</h2>
          <button style={styles.googleBtn}>Google로 로그인</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    marginTop: "100px",
  },
  card: {
    width: "300px",
    padding: "40px",
    borderRadius: "12px",
    boxShadow: "0 0 10px rgba(0,0,0,0.1)",
    textAlign: "center",
  },
  googleBtn: {
    marginTop: "20px",
    padding: "10px",
    width: "100%",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#4285F4",
    color: "#fff",
    cursor: "pointer",
  },
};
