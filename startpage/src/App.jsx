import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signin from "./pages/Signin";
import Main from "./pages/Main";

function App() {
  return (
    <BrowserRouter>
      <Routes>
  <Route path="/" element={<Home />} />
  <Route path="/main" element={<Main />} />
  <Route path="/login" element={<Login />} />
  <Route path="/signin" element={<Signin />} />
</Routes>
    </BrowserRouter>
  );
}

export default App;