import { BrowserRouter, Route, Routes } from 'react-router-dom'
import InstallBanner from './components/InstallBanner'
import Home from './pages/Home'
import Settings from './pages/Settings'
import Share from './pages/Share'

export default function App() {
  return (
    <BrowserRouter>
      <InstallBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/share" element={<Share />} />
      </Routes>
    </BrowserRouter>
  )
}
