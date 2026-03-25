import Navbar from "../components/Navbar";

function Signin() {
  return (
    <div>
      <Navbar />
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Sign in</h2>
          <input placeholder="Email" style={styles.input} />
          <input placeholder="Password" type="password" style={styles.input} />
          <button style={styles.btn}>회원가입</button>
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
  input: {
    width: "100%",
    padding: "10px",
    marginTop: "10px",
    borderRadius: "8px",
    border: "1px solid #ddd",
  },
  btn: {
    marginTop: "20px",
    padding: "10px",
    width: "100%",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#000",
    color: "#fff",
    cursor: "pointer",
  },
};

export default Signin;