import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import About from './pages/About'
import FAQ from './pages/FAQ'
import Tutorial from './pages/Tutorial'
import Statistics from './pages/Statistics'
import Contact from './pages/Contact'
import UsefulLinks from './pages/UsefulLinks'
import DataIndex from './pages/DataIndex'
import DownloadsPage from './pages/DownloadsPage'
import QTLPage from './pages/QTLPage'
import GWASPage from './pages/GWASPage'
import MultiTraitQTLPage from './pages/MultiTraitQTLPage'
import ClonedGenesPage from './pages/ClonedGenesPage'
import MetaQTLPage from './pages/MetaQTLPage'
import Map from './pages/Map'
import LinkagePlot from './pages/LinkagePlot'
import EpistaticPage from './pages/EpistaticPage'
import MTLPage from './pages/MTLPage'
import HotspotsPage from './pages/HotspotsPage'
import InsightsPage from './pages/InsightsPage'
import LiteraturePage from './pages/LiteraturePage'
import LinkageMapsPage from './pages/LinkageMapsPage'
import MarkersPage from './pages/MarkersPage'
import AdvancedSearch from './pages/AdvancedSearch'
import Credits from './pages/Credits'
import GenesPage from './pages/GenesPage'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/tutorial" element={<Tutorial />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/data" element={<DataIndex />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/data/qtl" element={<QTLPage />} />
        <Route path="/data/gwas" element={<GWASPage />} />
        <Route path="/data/multi-trait" element={<MultiTraitQTLPage />} />
        <Route path="/data/cloned-genes" element={<ClonedGenesPage />} />
        <Route path="/data/metaqtl" element={<MetaQTLPage />} />
        <Route path="/data/epistatic" element={<EpistaticPage />} />
        <Route path="/data/qualitative" element={<MTLPage />} />
        <Route path="/hotspots" element={<HotspotsPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/literature" element={<LiteraturePage />} />
        <Route path="/linkage-maps" element={<LinkageMapsPage />} />
        <Route path="/markers" element={<MarkersPage />} />
        <Route path="/map" element={<Map key="map" />} />
        <Route path="/plot/genome" element={<Map key="plot" mode="upload" />} />
        <Route path="/plot/linkage-map" element={<LinkagePlot />} />
        <Route path="/search" element={<AdvancedSearch />} />
        <Route path="/genes" element={<GenesPage />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/credits" element={<Credits />} />
        <Route path="/links" element={<UsefulLinks />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
